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

<!--
[ ] Under 200 lines   [ ] "Do not" lines filled in
-->
