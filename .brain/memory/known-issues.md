---
id: mem.known-issues
title: Known Issues
layer: L2
type: memory
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what is broken"
  - "is this a known problem"
  - "what code looks dead but isn't"
covers: "Active gaps, deliberate constraints that look like bugs, unresolved identity mysteries, resolved issues"
excludes: "Why a design choice was made (see mem.decisions), approaches already tried and abandoned (see mem.lessons)"
tokens_est: 2300
---

# Known Issues

---

## Active

### `pending_storage_deletions` has no sweep -- enqueuing a row deletes nothing
**Area:** Storage cleanup (`pending_storage_deletions`, migration 081) · **Severity:** slows work, no data loss risk today
**Symptom:** a row landing in `pending_storage_deletions` (e.g. a book PDF
whose direct Storage delete failed -- `lib/self-mastery/ingestion/book-pdf-gc.ts`)
sits there forever. `confirm_storage_deleted(path)` exists to dequeue a row
once a client's own delete succeeds, but nothing ever calls it for a queued
row, and no worker/cron sweeps the table to retry the underlying Storage
delete.
**Cause:** migration 081 shipped the table plus `confirm_storage_deleted`/
`purge_user_data` as the intended enqueue -> delete -> confirm design, with
"a worker sweep retrying leftovers" explicitly deferred, not built. Grepped
before relying on this (BRIEF-pdf-gc.md): confirmed nothing in this codebase
reads from this table at all.
**Workaround:** none automated. A row here means a real orphaned object in
the `books` bucket; clean it up by hand (Storage dashboard + a manual
`confirm_storage_deleted` call or row delete) until the sweep exists.
**Do not:** assume enqueuing a path here has any effect on its own --
`book-pdf-gc.ts` deletes directly and only enqueues on failure, precisely
because enqueue-alone is a no-op today.
**Tracked:** BRIEF-pdf-gc.md (2026-09-19) -- building the sweep was explicitly out of scope for that task.

### `SUPABASE_LEGACY_JWT_SECRET` is a single point of failure with no monitoring
**Area:** MCP connector auth (`lib/mcp/session.ts`) · **Severity:** blocks work if triggered
**Symptom:** if this key is ever revoked in Supabase, every MCP connector
session breaks with no fallback path.
**Cause:** Supabase's dashboard only offers key rotation via "Create Standby
Key" (no ES256 import), so the legacy HS256 secret was adopted instead (see
`.brain/memory/decisions.md`). Supabase's own UI labels it "revoke once all
tokens have expired," which is an invitation to revoke it.
**Workaround:** none — do not revoke this key. There is no canary or alert on
it today.
**Do not:** treat "revoke once expired" as safe to act on without first
confirming a replacement signing path is live.
**Tracked:** `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md`

### Vercel bot-protection can 403 the MCP connector with no code-visible cause
**Area:** `/api/mcp`, `/.well-known/*` · **Severity:** slows work, intermittent
**Symptom:** production alias has twice returned 403 "Vercel Security
Checkpoint" to every path including `/api/mcp`, triggered by test volume.
**Cause:** Vercel's automatic bot mitigation. An MCP client can't solve a
JavaScript challenge — if this engages while a connector is live, the request
dies silently; nothing in this codebase can detect it because the request
never arrives.
**Workaround:** it has cleared on its own both times so far.
**Do not:** assume a connector failure is a code bug before checking whether
bot protection is engaged.
**Tracked:** `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md` item 3 — a Vercel
dashboard exclusion for `/api/mcp` and `/.well-known/*` is proposed, not yet
done, and not currently blocking.

### "CollegeOS / B1" is an unidentified entity in the migration ledger
**Area:** `supabase/migrations/ALLOCATIONS.md` · **Severity:** annoyance /
context gap
**Symptom:** migration `113` is allocated to "CollegeOS / B1" for a Night Plan
`tasks` schema change; migration `127` names "CollegeOS Eng 1" as a verifier.
**Cause:** unknown. Nothing in the codebase's own docs defines what "B1" is —
a separate codebase, a session label, or something else.
**Workaround:** none needed unless working in that migration range.
**Do not:** assume "CollegeOS" here means the whole product merger this
install is documenting — it may be a narrower, session-specific label.
**Tracked:** untracked; flagged here for an operator to clarify.

### Writes of large files into a mounted repo path can silently truncate
**Area:** `node_modules/` native `.node` bindings, on a remote-device/mounted
working tree (e.g. a `device_bash` session where the repo lives on the user's
machine and is mounted into the shell's container) · **Severity:** blocks
work if triggered — the failure mode is a crash with no useful message
**Symptom:** `npx next build` died in well under a second with a bare `Bus
error` (SIGBUS, exit 135) — `next build` never got far enough to log
anything. Isolating it: `node -e "require('@next/swc-linux-arm64-gnu')"`
also SIGBUS'd, and even `file` on the raw `.node` binary crashed reading it.
**Cause:** `node_modules/@next/swc-linux-arm64-gnu/next-swc.linux-arm64-gnu.node`
was on disk at 18,222,112 bytes. The real package
(`npm view @next/swc-linux-arm64-gnu@<version> dist.unpackedSize`) is
89,763,682 bytes — the file had been silently truncated to ~20% of its real
size during install, with no error from `npm install` at the time. Any
attempt to `mmap`/read past the truncated point on this filesystem raises
SIGBUS instead of a normal I/O error, so the failure looks like a crash in
whatever touches the file first, not a corrupt-download error. This is the
same class of bug the team already hit once with
`@rollup/rollup-linux-arm64-gnu` (missing binding) — both are large native
binaries landing in a `node_modules` that lives on a mounted/synced path
rather than local disk. `@next/swc-linux-arm64-musl` was found truncated the
same way (18.5MB vs. a real 87.4MB) but is **not loaded on this glibc Ubuntu
box, so it's latent, not currently blocking** — leave it alone unless
something switches this environment to a musl runtime.
**Detection method:** compare the on-disk size of any large (>10MB) `.node`
file against its package's real size:
```bash
npm view <package>@<installed-version> dist.unpackedSize
ls -la node_modules/<package>/<file>.node
```
A mismatch of more than a few KB (small metadata files — README/LICENSE/
package.json — account for a few hundred bytes of the registry total not in
the `.node` file itself) means the file is truncated, not just a version
difference.
**Workaround:** a plain re-`npm install` of the single package does **not**
reliably fix it — npm can see the package directory already exists at the
right version and skip re-extracting the truncated binary entirely. What
worked: fetch the tarball to a path that is NOT inside the mounted repo
(ordinary container disk, e.g. `/tmp`), extract it there, then `cp` the
correct file over the truncated one inside the mounted `node_modules`:
```bash
cd /tmp && npm pack @next/swc-linux-arm64-gnu@<version>
tar xzf next-swc-linux-arm64-gnu-<version>.tgz
cp package/next-swc.linux-arm64-gnu.node \
   "$REPO/node_modules/@next/swc-linux-arm64-gnu/next-swc.linux-arm64-gnu.node"
# verify: size must equal dist.unpackedSize minus README+package.json bytes,
# and node -e "require('@next/swc-linux-arm64-gnu')" must load without SIGBUS.
```
Deleting the truncated file first (`rm`) worked in this instance; it did not
on a different gitignored artifact on the same mount earlier in the same
session ("Operation not permitted"), so don't assume delete always succeeds
— overwriting via `cp` onto the existing path is the more reliable step.
**Do not:** trust `npm install`'s exit code or "up to date" message as proof
a native binding is intact on this kind of mount — it does not checksum
already-present package directories. Do not assume a `Bus error` / SIGBUS
from any Node process is an application bug before checking file sizes on
large native `.node` bindings first.
**Tracked:** found and fixed 2026-09-13 while establishing the vitest/tsc/
next-build baseline (see `.brain/tooling/registry.md`); not yet automated as
a preflight check.

### Migration `116` (`reading_logs`) is on disk, unapplied to production, and structurally refused by the gated runner
**Area:** `supabase/migrations/116_generic_reading_log.sql` · **Severity:**
low today (table has zero consumers), but the file is currently un-appliable
as written
**Symptom:** `check-migrations-applied.sh` reports `116_generic_reading_log.sql`
as UNAPPLIED against production; `public.reading_logs` does not exist there
and there is no `migration_ledger` row for it. Running
`./scripts/apply-migration.sh --dry-run "$DATABASE_URL_POOLER"
supabase/migrations/116_generic_reading_log.sql` refuses outright: `exit 7`,
"this file contains its own transaction control" (bare `begin;`/`commit;` at
lines 25/51).
**Cause:** `116` was written and committed 2026-09-01, the same window R33
(the runner-owns-the-transaction rule, `apply-migration.sh`) was established
after migrations `111`/`114`/`115` each hit exactly this failure that night.
`116`'s own commit message says only "applied and verified on **scratch**" —
never production — and `ALLOCATIONS.md`'s standing rule names the mechanism:
"production applies go through `apply-migration.sh` — never bare psql. Two
migrations arrived invisible to the ledger that way in one night." `116`
almost certainly reached scratch the same ungated way, which is why scratch
tolerates the bare `begin`/`commit` its file carries and production's real
gate does not. It is not in `supabase/migrations/_withdrawn/` (present, but
empty) and `ALLOCATIONS.md` still lists it as `allocated`, not `withdrawn` —
this was never a deliberate decision, just a migration that was never run
through the one path that would have caught the problem before commit.
**Consumer check (2026-09-13):** zero references to `reading_logs` anywhere
in `app/`, `lib/`, `components/`, `scripts/`, or `supabase/` outside the
migration file itself and its own `ALLOCATIONS.md` row. The only other
mentions are historical: `.remember/archive.md` and
`.remember/today-2026-09-03.done.md` both flag "116_reading_logs" as an
already-known "latent trap" from a 2026-09-03 migration-safety inventory —
this is not a new finding, it was previously identified and deliberately
left alone. "A3 Part 3 / generic practice engine" as a *concept* does have
live consumers (`lib/home/day-ribbon.ts`, `lib/home/get-day-shape.ts` — the
`deen_habits.cue_time` half, migration 114), but that is a sibling feature,
not this table; `reading_logs` itself was never wired to any reader or
writer.
**Workaround / recommendation:** do not apply as-is. If/when this table is
wanted: strip the bare `begin;`/`commit;` (let `--single-transaction` own
the file, per R33), confirm it still has no intended consumer at apply time,
and apply through `apply-migration.sh` only — never bare `psql`. Until a
consumer exists, adding it to production only to tidy the ledger is not
worth the schema surface.
**Do not:** apply this file with a bare `psql -f` to "get past" the
`apply-migration.sh` refusal — that is the exact ungated path that produced
this state on scratch in the first place, and it's how "two migrations
arrived invisible to the ledger" the last time it happened.
**Tracked:** found (again) 2026-09-13 while making `check-migrations-applied.sh`
runnable for the first time on this machine (see the `psql` lesson,
`.brain/memory/lessons.md`); left unapplied pending a real consumer.

---

### `lib/mcp/__tests__/write-registry-school.test.ts` asserts the pre-151 `class_assessments.type` spelling
**Area:** `lib/mcp/**` (not E1's directory — found as a byproduct of
verifying migration 151's vocabulary during the `database.types.ts`
regeneration fix, not fixed here) · **Severity:** one failing test, not
production-facing
**Symptom:** `school.class_assessment.add > creates the linked task, then
the assessment, using the top-level id as the class id` fails with
`patch.type must be one of: quiz, exam, final_midterm,
homework_assignment, project_paper. Got: "midterm_final".`
**Cause:** the test fixture still passes `type: "midterm_final"`, the
spelling migration 151 (2026-09-13) renamed to `final_midterm` in both the
DB CHECK constraint and `lib/school/actions-core.ts`'s `ASSESSMENT_TYPES`
(which `lib/mcp/write-registry.ts`'s `requireEnum` now validates against).
The cross-boundary gap 151's own header flagged (`write-registry.ts`
hardcoding the old vocabulary) has since been closed — it now imports
`ASSESSMENT_TYPES` from `actions-core.ts` rather than hardcoding it — but
this one test fixture was not updated to match.
**Do not:** assume this test passing is required for anything in this
phase's own acceptance criteria — it is unrelated to `database.types.ts`.
**Tracked:** confirmed failing 2026-09-13 (E1) via
`npx vitest run lib/mcp/__tests__/write-registry-school.test.ts`; needs a
one-line fixture fix (`midterm_final` → `final_midterm`) by whoever owns
`lib/mcp/**`.

### T-0002 (per-subdomain Work data scoping) is still open — onboarding's inert widget picker has been REMOVED, not fixed
**Area:** `lib/domains/user-domains-core.ts:72`, `app/(app)/work/[subdomain]/page.tsx`,
`app/(app)/work/[subdomain]/layout.tsx` · **Severity:** architectural gap,
still real
**Was:** the Work subdomain onboarding step ("What should this screen
show?") let a user pick from 11 widgets, but the choice had zero effect on
what ever rendered, for all 11, regardless of which were picked. Full trace
(kept for history): `WorkStep` stored the selection into
`WorkSubdomainDraft.widgets` → `app/(app)/onboarding/actions.ts`'s
`saveSubdomains` wrote it into `user_subdomains.widgets` (a JSON column) →
`lib/domains/user-domains-core.ts:72` is the ONLY place outside onboarding
and tests that ever reads `.widgets` off a subdomain row, and it only maps
the column straight through into the returned state object — nothing reads
it after that. `app/(app)/work/[subdomain]/page.tsx` re-renders the same
`WorkPage` regardless of which subdomain (or its stored widgets) is active.
**Fixed (the symptom, not the cause):** Ayman ruled (a) on item 8 — remove
the affordance rather than leave a fake choice standing. `components/
onboarding/work-step.tsx`'s widget-picker sub-step, `widget-picker.tsx`,
and `widget-catalogue.ts` are deleted (ONB item 8b, 2026-09-19). Naming a
Work subdomain in onboarding now finalizes the draft directly with an empty
`widgets: []` — honest, since nothing downstream ever read a non-empty
value anyway. `WorkSubdomainDraft.widgets`, `SubdomainInput.widgets`, and
the `user_subdomains.widgets` column all stay — they're generic
per-subdomain architecture (`onboarding-wizard.tsx`, `actions.ts`,
`user-domains-core.ts`), not solely fed by the deleted picker, so removing
them was out of scope and would have been a second, larger cut this task
didn't ask for.
**Root cause (still open):** T-0002 (per-subdomain data scoping on
`coop_targets`/`coop_tasks`) hasn't landed — confirmed by an existing,
honest comment and UI note already in `work/[subdomain]/layout.tsx`: "Your
subdomains share one Work pipeline for now — per-subdomain separation is
coming." **This matters MORE now, not less**, per Ayman's own framing: the
UI no longer even hints a per-subdomain feature is coming, so if T-0002
ever lands, whoever builds it needs to know there is currently zero UI
scaffolding pointing at it.
**Do not:** resurrect a widget picker in onboarding, or any other per-
subdomain widget-selection UI, until T-0002 actually lands and something
reads the choice.
**Tracked:** found 2026-09-19 (Sonnet ENG 3, ONB item 8 audit), confirmed
independently by Opus Lead. Symptom removed 2026-09-19 (Sonnet ENG 3, ONB
item 8b, per Ayman's ruling relayed via Opus Lead in
`.claude/overnight/run-20260915-0011/BRIEF-eng3-item8.md`) — see
`.claude/overnight/run-20260915-0011/ONB-PLAN.md` and `OPEN_QUESTIONS.md`
for the original ruling thread.

### `widget-catalogue.ts` cited a source document that didn't exist in this repo — resolved by removal
**Area:** was `components/onboarding/widget-catalogue.ts`, now deleted ·
**Severity:** was documentation-integrity defect, independent of whether
the widgets worked
**Was:** the file's header comment attributed its contents to "Engineer 2's
cross-cutting systems research (2026-09-01): the confirmed-drop-in and
confirmed-real-gap findings recorded in DECISIONS.md D-010/D-011." Grepped
the full working tree and `git log --all` for `DECISIONS.md`, `D-010`, and
`D-011` at the time — none existed anywhere in this repo or its history.
**Resolved:** the file was deleted whole (ONB item 8b, 2026-09-19) along
with the widget picker it backed — confirmed via grep that nothing outside
onboarding imported `WORK_WIDGET_CATALOGUE`/`defaultWidgetIdsFor`, so
nothing else needed the (unsourced) catalogue either. No live file left to
carry a stale citation.
**Tracked:** found 2026-09-19 (Sonnet ENG 3, ONB item 8 audit); resolved
2026-09-19 (Sonnet ENG 3, ONB item 8b).

### Fixed 2026-10-04 — closing the day after midnight closed/planned the wrong day
`/close` Finish recorded `evening_closes` for the *new* local date and `planningDateForCore('tonight')` planned local-today + 1, so a 00:30 close left the day just ended unclosed and planned two days ahead. Fixed by `effectiveDayString` (4 AM rollover) in `75313d4`; see `.brain/memory/decisions.md`. Rows already written before the fix keep their old dates.

### Open — Launch steps can't be reordered; Work tabs share data
Steps are ordered by `created_at` (no position column — needs a migration). Same-kind Work tabs show one shared pipeline (T-0002). `/api/cron/sleep-reminder` IS scheduled: the `dispatch-notifications-every-15min` pg_cron job posts to it (with daily-due-card, nightly-morning-brief, weekly-synthesis, practice-test-assembly, lecture-transcription, canvas-sync) — verified 2026-10-04 by reading the untruncated `cron.job.command`. Late wind-downs: fixed in a7514a9 (the window opens no later than 23:30).

## Deliberate constraints that look like bugs

### `checkin-scheduler.tsx` / `checkin-scheduler-loader.tsx` are unmounted, not dead
**Looks like:** orphaned components with no importers (they are, in fact,
never mounted).
**Actually:** built to prompt check-ins outside a Lock-In session and never
finished/wired up. Verified inventory in
`docs/superpowers/notes/2026-08-18-orphaned-code.md` explicitly separates this
from the ten genuinely-superseded orphans in the same list — deleting it would
discard unfinished work, not tidy up dead code.
**See:** `.brain/memory/decisions.md`; the recommendation in the source note
was to keep this pending a decision on whether the feature is still wanted.

### `traveling-toggle.tsx` is a real product gap, not dead UI
**Looks like:** an orphaned component (33 lines, no importers).
**Actually:** it's the UI for `profiles.traveling_mode`, which still exists in
the schema and is read nowhere. Travel affects prayer obligations materially
(shortened/combined prayers), so this is a genuine unaddressed gap in the Deen
domain, not cleanup-eligible.
**See:** `docs/superpowers/notes/2026-08-18-orphaned-code.md`.

---

## Tooling gaps, since resolved

### `database.types.ts` regeneration silently required Docker — resolved
**Was:** `apply-migration.sh`'s post-apply regen step ran `npx supabase gen
types typescript --db-url ...`, which looks like a pure API call but always
shells out to Docker/Podman to run `supabase/postgres-meta` locally, even
with `--db-url` — the CLI binary has no type-generation logic of its own. On
this project's dev sandbox (no Docker/Podman, no root), that command failed
with `docker: command not found` and empty stdout, and the regen step's own
`2>/dev/null && [ -s ... ]` check swallowed the failure into one warning
line. It did this silently across migrations 150, 151, 152 and 156 (E1,
2026-09-13): `ai_usage_log` (156) landed untyped, a finished feature reading
152's new columns had to be reverted, and 151's `class_assessments.type`
CHECK-constraint rename went unreflected.
**Fixed by:** `scripts/gen-database-types.sh` (E1, 2026-09-13) runs
`@supabase/postgres-meta` — an ordinary npm package, pinned to the exact
version the CLI's own Docker image uses — directly via its documented
env-var "generate and exit" mode, no container needed. `apply-migration.sh`
now calls this script and fails loudly (non-zero exit, message on stderr)
instead of one easy-to-miss warning line. See `.brain/tooling/registry.md`
("Regenerating `lib/supabase/database.types.ts`") for the command and the
fidelity verification behind it.
**Watch for:** if a future `supabase` CLI upgrade moves its pinned
postgres-meta version, `scripts/gen-database-types.sh`'s own header
explains how to re-verify the pin and bump it — don't assume the script
stays correct forever unattended.

### Migration 151's own CROSS-BOUNDARY NOTE is now half-stale (2026-09-14)
**Was:** `supabase/migrations/151_widen_class_assessment_types.sql`'s header
flags `lib/mcp/write-registry.ts`'s `ASSESSMENT_TYPES` and
`lib/mcp/registry.ts`'s class-assessment `description` string as BOTH still
hardcoding the pre-151 3-value vocabulary (`quiz/exam/midterm_final`).
**Now:** only half true. `write-registry.ts` does not hardcode its own copy
-- it imports `ASSESSMENT_TYPES` directly from `lib/school/actions-core.ts`
(already the correct 5-value list), so that half of the note is resolved,
apparently fixed sometime after 151 was written. `lib/mcp/registry.ts`'s
description string DID still read the stale 3-value text -- fixed directly
(E1, 2026-09-14; found in an adversarial verification pass) since it is a
one-line string with no behavioral coupling, and since that text is read by
LLM agents as ground truth for valid values via the MCP tool schema, not
just by humans -- stale vocabulary there is actively misleading, not merely
untidy.
**Do not edit `151_widen_class_assessment_types.sql` itself to fix this**
even though its header is now inaccurate: the migration is already applied
to production, and `check-migrations-applied.sh` (part of
`preflight.sh`'s DB branch) compares every migration file's current md5
against `migration_ledger`'s recorded md5 -- editing so much as a comment
in an applied migration file makes that check report it as "EDITED AFTER
APPLY," a real tamper-detection signal this repo relies on, for no schema
benefit (verified: attempted this fix directly in the migration file first,
reverted once the ledger-md5 consequence was found). This entry is the
correction; the migration file stays exactly as applied.
**Tracked:** found and the `registry.ts` half fixed 2026-09-14 (E1).

## Documentation known to be stale as written, since resolved

### `docs/ai-connector/PROGRAM-PLAN.md` / `docs/ai-connector/CAPABILITIES.md` widget-CHECK claim — resolved
**Was:** stated the `mcp_widgets.kind` CHECK constraint only admitted
`metric_card`/`list`, with `progress_against_goal`/`sparkline`/`streak`
rejected at the DB layer despite having validation and render code.
**Fixed by:** migration `149_mcp_widgets_kind_widen.sql` widened the CHECK to
admit all five kinds (verified against production in a rolled-back
transaction before merging). `components/home/mcp-widgets-panel.tsx` already
has a live `"streak"` render branch, confirming the gap PROGRAM-PLAN.md
described is closed.
**Watch for:** PROGRAM-PLAN.md and CAPABILITIES.md themselves have not been
edited to reflect this — treat their widget-kind claims as stale until someone
updates them.

### `docs/ai-connector/SCHOOL-UPDATED-AT-NEEDED.md`, `docs/ai-connector/WORK-BUSINESS-UPDATED-AT-NEEDED.md`
**Status:** requests, not yet-numbered migrations, per this repo's own
standing rule ("if a domain needs updated_at columns, that's another
migration — tell me and I'll allocate, don't self-number"). Five School tables
and four Work/Business tables are documented as missing a faithful
`updated_at`. Check `supabase/migrations/ALLOCATIONS.md` before assuming these
are still open — they may have been allocated and applied since this file was
last read.

### `supabase.auth.admin.deleteUser` fails for some `onboard-*@example.com` e2e accounts
**Found:** 2026-09-15, goals-builder, regression-suite triage. `e2e/onboarding.spec.ts`'s
`afterEach` (f0f3f62, 2026-09-01) is supposed to hard-delete every fresh account
`signUpFresh()` creates, via the service-role admin API. Two accounts from a
2026-09-15 run (`onboard-1789443637820-abztbe@example.com`,
`onboard-1789443200600-aoy0zx@example.com`) survived it. Reproduced directly:
`admin.auth.admin.deleteUser(id)` returns `"Database error deleting user"` for
both, deterministically (retried once, same result) — not a transient
connection blip. Every FK in `public` that references `auth.users` is
`ON DELETE CASCADE` (checked all 94 via `pg_constraint`), so it isn't an
uncascaded child row in a table this repo owns; more likely a GoTrue-internal
failure (an auth-schema trigger, or something specific to these two rows).
**Not fixed:** `afterEach`'s own `await admin.auth.admin.deleteUser(match.id)`
call never checks the returned `error` — a failure like this one is silently
swallowed, which is exactly how these two went unnoticed. The two rows above
are still live in production `auth.users`; direct SQL deletion is blocked by
this environment's own destructive-op gate, and the admin API itself is what's
failing, so they could not be removed in-session. Left for the Lead — either
someone with a working deletion path, or Supabase support if it's GoTrue-side.
**Fix direction (not done):** check and log/retry the `error` in `afterEach`
so a repeat of this isn't silent next time.

### MCP connector docs and comments had drifted from the code (fixed 2026-09-15, P4-04)
**Found:** 2026-09-15, p4-b-core, from the P4 capability audit. Code was right, docs wrong:
`docs/ai-connector/CAPABILITIES.md` claimed Night Plan items were writable through
work/distractions (no write action touches them) and that three widget kinds were not creatable
(migration 149 fixed that; all five render). `app/api/mcp/route.ts`'s header said "four of seven
tools", "deen's 8 entities" and an ES256 session JWT (reality: 5 tools, every domain, HS256).
`registry.ts` / `read.ts` headers still said only deen.prayer was wired, and the brain doc's
counts were stale. **Fixed:** all of the above, with counts from the new
`npx tsx scripts/mcp-surface-counts.ts` instead of typed numbers. **Still open:** nothing
regenerates those counts automatically. Re-run the script whenever the registries change.

### `prayers.status` has no DB-level enum guard (found 2026-09-16, DFT8)
**Found:** two `prayers` rows on shared test accounts had `status: 'pending'` — a value
`markPrayerCore`'s own TypeScript signature (`"on_time" | "qada" | "missed"`) can never write, so
these were leftover raw-insert seed debris, not reachable through the real app or MCP. **Why it
matters:** `effectivePrayerStatus` treats any non-null, non-`'unlogged'` stored value as authoritative
and returns it as-is — a stored `'pending'` freezes a day at "Pending" forever, even after its
window closes, with nothing to ever re-derive it as `'missed'`. There is no Postgres CHECK
constraint on `prayers.status` catching this at the DB layer; the guarantee is TypeScript-only.
**Fixed:** deleted the two bad rows (not the schema). **Still open:** whether a CHECK constraint is
worth adding is a real judgment call, not done here.

## 2026-10-04 — Open items from the Deen Mode run

- **`SEED_USER_EMAIL` account is absent from prod** (`auth.users` exact match = 0). Playwright's main projects cannot log in; only the Domains Fixture project runs, and specs using `useDeenMode` on SEED projects fail in `beforeAll` until it exists.
- **`dispatch-notifications` redeploy pending.** The gate (`supabase/functions/dispatch-notifications/gate.ts`) is in the repo but until the edge function is redeployed the old function still sends prayer push regardless of `deen_mode` (the supabase CLI/MCP were not authorised for the project during the run).
- **`.claude/` is excluded from tsc and vitest (1d5cc9c).** A QA worktree created inside the repo polluted both runs ("useState of null", duplicate files). Put worktrees OUTSIDE the repo (`~/.cache/lifeos-qa-wt`).
- **Playwright browser build pin:** the installed chromium-headless-shell is v1234 (Playwright GC removed 1246 builds); a different Playwright version needs its matching browser.
- Home's `qadaBacklogCount` and the Deen card must keep using `qadaWindowStart` together (parity test in `lib/home/__tests__/get-domain-snapshots.test.ts`).
- **`e2e/deen-mode.domains.spec.ts:146` flake (2026-10-04 23:40):** `salahPanel.locator("li", { hasText: "Isha" })` once resolved to 2 `<li>` (one hidden) on /deen → strict-mode violation; the same spec passed 6/6 on an immediate re-run against the same build. Likely a transient duplicate during the route's streaming/transition. If it recurs, scope the locator with `.filter({ visible: true })` or `.first()` after checking which element is hidden.
- **`e2e/home.spec.ts` asserted the retired "The day's shape" panel** from HOME-02 (day bar, deployed 2026-10-04) until b7e3cb5; nobody ran home.spec at that deploy. It now follows `HOME_DAY_VIEW`. Lesson: when a UI switch retires a panel, grep `e2e/` for its title in the same task.
<!--
[ ] Under 200 lines   [ ] "Do not" lines filled in
-->
- **Parity test missed `delayItem` at deploy (2026-10-05):** Home's Delay (`app/(app)/actions.ts#delayItem`) shipped without a `lib/mcp/parity-manifest.ts` decision because the author ran only app/home/school suites, not `lib/mcp`. Fixed in the HABIT-FREQ commit. Lesson: after adding ANY `"use server"` export, run `npx vitest run lib/mcp` (the parity test is the only thing that sees it).
- **`identity_habits` / `habit_votes` are absent from the data export (`app/(app)/settings/export/route.ts`) and have no MCP read entity** (found 2026-10-05 while wiring HABIT-FREQ; pre-existing, not fixed there). Also `getActiveHabitsWithVotes` reads all votes with no pagination, so past ~1000 votes (7 daily habits x ~140 days) PostgREST's row cap would silently truncate the decay score.
- **Pre-existing preflight failures seen 2026-10-05 (none touch habits):** `check-enum-drift` (`class_assessments.type` widened by 257, TS union not), `check-fk-tenancy` (`agent_connect_codes.minted_token_id`, `mcp_webhook_deliveries.webhook_id` single-column FKs), `check-scheduler-cache-drift` (psql errors on a non-UUID `reviews.card_id` "41"), and an unlisted skip in `lib/ai/__tests__/dev-provider-injection.test.ts`.


- **Plan details gaps (2026-10-06):** (1) leaving Work after entering it does NOT remove the Backlog task it created (nothing links them; the Kill List pair is the only linked one); (2) the plan list does not show "in session" on a row whose Deep Work/Study is running (pressing Start again reports "a session is already running"); (3) the MCP twin of `commitPlan`/Start/Complete is `pending: P4-cov-PLAN-DETAILS` in the parity manifest, and it must UN-PLAN rather than delete (the MCP path never hard-deletes); (4) a plan written before migration 260 has no details and shows as plain lines; (5) an unfinished inline timer is not stopped by changing the line's timer length.

## 2026-10-20 — Open lows from the Focus reader run (none blocks reading; all known and accepted)
- **Settings order on unload:** keepalive requests normally arrive in order but the browser does not promise it. `createSettingsSender` sends one at a time and the unload request carries the newest value of everything unconfirmed, yet an OLDER request still in the air could land after it (`lib/reader/unload-beacon.ts` comment).
- **Reload within ~4 s of a seek:** the server position is debounced 4 s (`createPositionSync`, flushed on pagehide). A reload inside that window relies on the localStorage copy; with storage blocked, or on another device, the server still has the older word.
- **Share-sheet size:** the share POST answers a readable `?error` up to 4 MB + 64 KB; between that and above Vercel's 4.5 MB body limit Vercel answers itself with a plain 413 the share sheet shows as-is (board R10 review).
- **Signed-out share loses its body:** a share POST while signed out redirects to login; the form body (text/files) cannot survive that redirect, so the person has to share again after signing in (a signed-out GET share keeps its query string through login).
- **Two-tab session queue:** the unsent-stretch queue is one `localStorage` key, last write wins, so a second tab can overwrite the first tab's offline queue (<= 10 stretches).
- **Cross-user queue burn:** that queue is not tied to a user id; after sign-out/sign-in as someone else on the same browser, the old user's stretches are refused (book not theirs) and dropped after 3 tries - no wrong credit, a few lost stretches.

## 2026-10-25 — Book upload (Self-Mastery) notes
- **Archived candidates are never deleted.** Every extracted candidate stays as a `lessons` row with `status='archived'`, `rank=null`; only the ≤60 ranked survivors become `active`. A finished book therefore carries hundreds of archived rows (storage, and any `lessons` count that does not filter `status='active'` is wrong). Accepted for now; a cleanup (delete archived-null-rank rows after `finalizing`) is not built.
- **Retry is refused once the book has been studied.** `retry_book_ingestion` (272) returns `has_history` when the book has reviews, promotions or self-explanations, because a retry deletes the book's lessons and the review log is append-only. A partially-studied failed book must be re-uploaded as a new book.
- **The ingestion cron is not in the repo.** pg_cron jobid 5 (`self-mastery-ingestion-driver-every-1min`) and the Vault secret were applied by hand (migration 166 says so); nothing recreates them.
- **The stuck-book "no job" check keys on `books.created_at`** and looks only at the 25 oldest `processing` books per poll (`books` has no `updated_at`).

