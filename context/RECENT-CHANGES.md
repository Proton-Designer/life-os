# Recent Changes

**As of: 2026-08-31, verified against `HEAD = dff284f`.**

This document is the most perishable of the four `context/` files. Everything
in it decays — commits keep landing, bugs get fixed, dead code gets deleted.
Read the "As of" line above before trusting anything here, and see **How to
keep this file current** at the bottom before you add to it.

## Status as of 2026-08-31

- **HEAD:** `dff284f` (the `context/` handoff-folder commit itself), sitting
  on top of `b091810` (2026-08-31 21:52 CDT, the Settings prayer-time-preview
  timezone fix — see Recent work below) and `69f8adb` (2026-08-30 16:21 CDT,
  "fix: center and enlarge Focus time today's minute count on Business").
- **Working tree:** clean.
- **Deployed:** the last *verified* deploy is `69f8adb`, not current `HEAD`.
  `npx vercel ls --token "$VERCEL_TOKEN"` showed the most recent Production
  deployment (`dpl_5Y2izTPaaU3WGirZ3ugeatBBsYze`) created 2026-08-30 16:22:33
  CDT — one minute after `69f8adb`'s commit timestamp — aliased to the live
  URL, `https://tracking-app-sand.vercel.app` (confirmed reachable, HTTP
  200). This deploy is token-based (see `docs/DEPLOYING.md`), not
  GitHub-linked, so Vercel attaches no git SHA metadata to the build
  directly — the timestamp match is the evidence, not a stored commit hash.
  `b091810` and `dff284f` landed after that deploy and have not been
  verified live — until the next deploy, the fixed Settings prayer-time
  preview is committed but not yet in production.
- **`tsc --noEmit`:** clean, zero errors.
- **`vitest run`:** 201 test files, 1656 tests, all passing.
- **Playwright / e2e:** **not run for this document** — running the full
  suite is Lead-only (see `AGENTS.md`, "Only ONE agent runs Playwright at a
  time"). Its last known-good state is whatever the Lead most recently
  verified; this file makes no claim about it beyond that.

## Recent work, newest first

### 2026-08-31 — Another live instance of the UTC-calendar-date bug class, in Settings

`b091810`: the prayer-time preview in `components/settings/location-settings.tsx`
called `calculatePrayerTimes` directly with a raw `new Date()` instant.
`calculatePrayerTimes` is timezone-naive by design — it reads whatever UTC
Y/M/D fields it's handed — and the safe entry point
(`computePrayerWindows`, `lib/prayer-times/windows.ts`) pre-anchors the date
to the local calendar day specifically to guard against this. This call site
bypassed that safe entry point, so for any UTC-negative timezone (Ayman's
`America/Chicago` included) the preview silently computed *tomorrow's*
prayer times every evening from roughly 19:00 local onward — the same
underlying failure mode as the original `03ab12b` incident (2026-08-24).
`AGENTS.md` records that incident as three hits in one night across three
different layers (shipping code, hand-written SQL, a test fixture), which
makes this the **fourth** instance of the bug class overall, and only the
**second** to land in live shipping code — this call site used the raw
calculation function instead of the normalized wrapper. Fixed by anchoring
to `new Date(\`${localDateString(new Date(), location.timezone)}T00:00:00Z\`)`
before calling `calculatePrayerTimes`, mirroring what `windows.ts` already
does. `AGENTS.md` gained the scar entry for this specific recurrence.

**What you'd notice:** if you opened Settings and changed your location or
calc method in the evening, the prayer-time preview shown there had been
one calendar day ahead of what your actual Deen screen showed — cosmetic to
that one preview, not a correctness bug in the times you actually track by.
But it stayed cosmetic by luck of which call site got bypassed this time,
not by any containment the codebase actually provides — the next
`windows.ts` bypass might not land somewhere this harmless.

### 2026-08-28 — Batch 5: performance pass across the whole app

The single largest theme in the last six weeks. Motivation: navigation felt
slow because pages were doing sequential, avoidably-blocking data fetches
before showing anything.

- **Route-level loading skeletons.** `9fe9715` added a `loading.tsx` to every
  route, each mirroring that page's real layout, so navigation shows an
  instant, shaped placeholder instead of a blank screen during a slow fetch.
  `0a98ef8` added a ~130ms delay before the skeleton fades in, specifically so
  a *fast*-resolving navigation never flashes one at all — you only see a
  skeleton if the wait is actually long enough to need one.
- **Waterfall flattening.** Several commits replaced sequential `await`s that
  didn't actually depend on each other with parallel `Promise.all`-style
  fetches: `e473194` (`AppShell`'s `getProfile`/`getActiveWorkSession`),
  `d59eeb2` (the same pair, reached from `layout.tsx` instead — a *different*
  round trip AppShell's own parallelization couldn't reach), `7e4e9bc`
  (School and Fitness pages), and `cb5ae23` (Work page's RSC waterfall,
  bundled with the `useOptimistic` change below).
- **`useOptimistic` on the Work pipeline.** `cb5ae23` made pipeline
  mutations (reordering, completing) show instantly instead of waiting on
  the round trip; `1dee5df` closed the follow-up gap — a mutation that
  throws now reverts the optimistic state instead of crashing the route.
- **Navigation-unblocking fix.** `95a26e2` wrapped `app/(app)/layout.tsx` in
  a `Suspense` boundary — without it, a slow shell-level fetch was blocking
  every route change, skeletons included.
- **Kill-list query gating.** `d0b2bc0`/`8a9a487` — `AppShell` only queries
  the kill list when there's an active Deep Work session showing the overlay;
  every other route and an idle Business page now pay zero extra round
  trips for it.
- **e2e follow-through.** `242797a` and `7cb82b0` made non-auto-waiting test
  reads safe against the skeleton race the new `loading.tsx` files
  introduced (a read that fires before the skeleton clears can catch stale
  content).

**What you'd notice using the app:** navigating between screens feels
snappier and shows a shaped placeholder instead of a blank flash on a slow
connection, but never flickers one on a fast one.

### 2026-08-28 — Work screen restructure: Weekly Agenda merged into Pipeline

`1c7e8b2` is the core commit: the separate Weekly Agenda view was folded
into the Pipeline panel (renamed "Weekly Agenda Pipeline" — `655de61`
updated tests to match), a Past-completed section was added
(`238515d` added the `coop_tasks.completed_at` column backing it, migration
055), and the schedule strip got a more compact redesign (`cf52f94`).
`87c8b68`/`74ef957` are the test coverage written directly against this new
contract.

**What you'd notice:** Work no longer has two separate places to look for
this week's plan vs. the agenda — it's one panel, and completed items move
to a Past section instead of just disappearing.

### 2026-08-26 to 28 — Mobile overflow sweep (390px and 320px)

A long run of fixes, not one commit, closing horizontal-overflow bugs found
by testing narrow phone widths. Representative commits: `3d613cd` and
`52a5418` (topbar/School panel at 320px), `0e25084` (`/deen` prayer row),
`a32f6dd` (`min-w-0` added to unshrinkable flex chains in the kill list,
School task rows, class-card assessments — the fix pattern repeats because
flex items refuse to shrink below their content's natural width unless told
to), `886637b` (habit focus card stacks instead of squeezing on mobile),
`85d34df` (row metadata was overlapping and swallowing clicks on sibling
Edit/Remove buttons), `ba93397`/`b29e6e6` (Work goal-reorder arrows had
shrunk below the 40px minimum tap target). `0023839`/`5623bca` fixed the
pinch-zoom math itself (`usePinToVisualViewport`) and floored pinch-zoom-out
at the default scale so the bottom nav stays pinned. `3c7a3b4` added a real
CDP pinch-gesture e2e test rather than trusting a synthetic one.

**What you'd notice:** using the app on a phone, text and controls no longer
run off the edge of the screen or overlap each other at narrow widths.

### 2026-08-28 — Deep Work Lock-In kill list

`f0e9dbd` added today's three-item kill list, checkable, directly inside the
full-screen Deep Work Lock-In overlay — the same underlying rows and toggle
action as the Business-page kill list, so a check there shows up everywhere
else the instant realtime sync fires. `8a9a487` (same day) is the
performance gate described above. This is Business-domain only — Deep
*Study* sessions don't show a kill list, since the underlying feature has no
study equivalent.

### 2026-08-26 to 28 — Deen prayer-window correctness

`1ae6d43` fixed a real logic bug: a prayer was being treated as actionable
merely because it was "upcoming," when it should only become actionable once
its own time window actually opens. `4ea4ef9` is the matching fix for the
empty state, keeping the next prayer visible as read-only info rather than
hiding it. `d816b24` (slightly earlier, 2026-08-26) floored prayer-status
derivation on `tracking_started_on` rather than `created_at`, so a habit's
history doesn't appear to start before the user actually began tracking it.

This sits alongside the larger timezone-correctness fix from a few days
earlier, `03ab12b` (2026-08-24, "Fix prayer windows computed for the wrong
calendar day after ~7pm local") — the origin incident for the calendar-date
rule now codified in `AGENTS.md`. That fix predates this six-week window's
start by a few days but is the reason the class of bug exists in institutional
memory; see `AGENTS.md`'s "Never derive a calendar date from a raw `Date`"
section for the full incident writeup.

### 2026-08-25 to 26 — Distractions / Action Plan / Review system built

The Distractions feature (capture, Action Plan dialog, nightly Review) was
built across this window: schema and RPC (`9720eb0`, `f4bbe12`, migration
041), the capture dialog and topbar wiring (`fe2550e`), Action Plan exclusion
behavior and e2e coverage (`ccd005a`), and the Review popup UI
(`e94a136`, converting what was a topbar tab into a popup to match
Distractions' own feel). `d03737c`/`eb276bf` fixed a realtime sync gap
specific to Work/co-op coverage found during this build (a session-restore
race — the client was joining its realtime channel before auth had
resolved).

### 2026-08-24 to 26 — School restructure

A dense run of School-screen work: classes as a real entity with assessments
and syllabus storage (`36240be`, migration item 6a), class cards grid and
expanded class view (`6331073`, `07e7a0c`), a task wizard with a proper
task-type taxonomy (`6bea95d`), unifying Deadlines and Task list into one
grouped/filtered module (`87119ee`), in-browser syllabus viewing instead of
forced download (`2360afb`, using `docx-preview` for `.docx` with an honest
"can't be previewed" fallback for anything else — PDFs render in an
`<iframe>`, which always worked), and a redesign pass on the expanded class
view itself (`191e845`, `07f20bc`... see `08f20bc`). `abd8382` seeded Fall
2026 tasks and syllabi from Ayman's actual five syllabus files.

### 2026-08-22 to 24 — Fitness rebuild, Work/Co-op rename, Home Focus module

Three threads landed close together: a multi-phase Fitness rebuild
(`1f6c0bc` through `6076486`, deleting the superseded single-workout builder
and adopt-plan action in favor of `createPlanFromTemplate`); renaming
"Co-op" to "Work" everywhere (`434c725`); and building the Home Focus
module — Lock-In session infrastructure with a full-screen overlay and
minimize/persist behavior (`69bbe95`, `72649c4`), later split into distinct
Deep Work vs. Deep Study session kinds (`aee2eb0`).

## Known-open items

Each item below was re-verified against current code on 2026-08-31, not
assumed from a prior list.

- **Action Plan pencil-edit overwrites irrecoverably — confirmed.**
  `saveActionPlan` (`app/(app)/distractions/actions.ts`) does an in-place
  `UPDATE` on the current plan row when one already exists; there is no
  versioning on this path. Versioning (`superseded_at`, bumped version rows)
  only happens on the separate review-forced-rewrite path, through the
  `save_trigger_plan` RPC (migration 041) — and nothing in the UI currently
  reads or displays a plan's prior versions once superseded, so that history
  is captured in the database but invisible to Ayman.
- **A missed 9PM–4AM review window has no catch-up — confirmed.** Review is
  only open (`isReviewOpen`, `lib/distractions/plan-rules.ts`) from 9PM
  through a 4AM tail the same night, and the date it targets
  (`reviewDateFor`) is only ever "today" or, during the tail, "yesterday" —
  never further back. If that window passes unopened, that day's captures
  are never re-surfaced anywhere.
- **No forgotten-password flow — confirmed, still true.** A repo-wide,
  case-insensitive search for reset/forgot-password routes or components
  under `app/` returns nothing.
- **A target's deadline can't be changed once set — confirmed, mechanism
  slightly different than described.** There is one `SetDeadlineDialog`
  instantiation (`components/co-op/targets-strip.tsx`), reused for both the
  ranked Target slots and the Stretch goals list. `TargetRow`
  (`components/co-op/target-row.tsx`) only renders the "Set a deadline"
  button when `target.deadline` is empty; once a deadline exists it renders
  a plain (non-interactive) badge instead. So the gate is real, it's just one
  shared dialog with a render-time condition, not two separately-gated call
  sites.
- **The "move unfinished tasks to your new Target 1" offer — confirmed
  absent entirely, not built as dead UI either.** `coop_tasks` rows do carry
  a `target_id` (set on insert in `app/(app)/work/tasks-actions.ts`'s
  `addAgendaTask`), so a task's tie to a specific target is real. But when a
  Target 1 completes, `completeTarget` (`app/(app)/work/targets-actions.ts`)
  only reports which target got promoted into the now-open slot
  (`promotedTargetId`) — it never touches the old target's tasks, and a
  repo-wide search for "unfinished" or any migrate/move/carry-over language
  near the Targets code found nothing. Any task still open under the
  completed target simply stays attached to it; nothing offers to reattach
  it to the new Target 1.
- **The kill list has no delete affordance — confirmed, and the deeper
  finding is that there's no delete *action* to wire up in the first
  place.** `app/(app)/business/actions.ts` defines exactly two Server
  Actions against `kill_list_items`: `setKillListItem` (upsert — sets a
  slot's text) and `toggleKillListItem` (flips `completed`). No delete/clear
  RPC or query exists at all. It's not that a delete button was left off an
  existing capability — `KillListSlot` (`components/business/kill-list.tsx`)
  also blocks submitting empty text (`if (!trimmed) return`), so there is no
  way, even indirectly, to clear a slot's text back out through the UI
  either. This is a smaller gap than the "affordance missing" framing
  suggests: the backend has never supported removing or clearing an item,
  only setting and completing one.
- **Built-but-unwired Deen features, all confirmed still true:**
  `components/deen/traveling-toggle.tsx` (backed by a real, working
  `setTravelingMode` action), `components/deen/adhkar-strip.tsx`, and
  `components/deen/qada-counter.tsx` each have zero non-test importers
  anywhere in `app/` or `components/`. All three have working Server Actions
  behind them — this is unwired UI, not incomplete backend work. The
  traveling toggle is the one worth prioritizing: prayer times genuinely
  change when traveling, so this is a real feature gap Ayman would likely
  want, not just leftover scaffolding.
- **Intermittent PDF-syllabus flake in `e2e/school-class-view.spec.ts` —
  unverified this session** (running Playwright is Lead-only). The test in
  question is the "viewing a pdf/docx syllabus opens a popup and does not
  download" spec, parameterized over the DSA (PDF) and Ameri Studies (.docx)
  classes, roughly lines 106–125. Code location confirmed; flakiness itself
  not independently reproduced here.

## Dead code inventory

Re-checked with exact import-path grepping (not a substring match, which
produces false positives — see the correction below) against `app/` and
`components/` on 2026-08-31.

**Genuinely dead — zero live importers, delete candidates:**
- `components/home/pulse-strip.tsx`
- `components/home/priority-list.tsx`
- `components/home/weekly-summary-strip.tsx`
- `components/home/domain-peek-cards.tsx` (and its sole consumer,
  `components/home/domain-peek-card.tsx` — both dead together, one imports
  the other but neither is reached from anywhere live)
- `components/business/weekly-goal-card.tsx`
- `components/fitness/quick-add-sheet.tsx`
- `components/fitness/assign-workout-picker.tsx`
- `components/fitness/rep-goal-bars.tsx`
- `components/fitness/home-on-plan-card.tsx` (and its sole consumer,
  `lib/fitness/load-workout-details.ts` — same dead-pair pattern)
- `lib/fitness/habit-consistency.ts`

**Built-but-unwired — product gaps, not delete candidates** (also listed
under Known-open items above): `components/deen/adhkar-strip.tsx`,
`components/deen/traveling-toggle.tsx`, `components/deen/qada-counter.tsx`.

**Correction to the list handed off for this sweep:** `lib/fitness/consistency.ts`
is **not** dead. It's imported by `lib/home/get-domain-snapshots.ts`, which
is itself imported by `app/(app)/page.tsx` (Home) — a live chain. The
original list likely conflated it with `lib/fitness/habit-consistency.ts`
(similar name, genuinely dead, listed above). Do not delete
`lib/fitness/consistency.ts`.

**Also confirmed NOT dead, per the original assignment's note** (included
here so the correction and the confirmation don't get confused with each
other later): `components/home/next-up-hero.tsx` has exactly one importer,
`app/(app)/deen/page.tsx` — it renders only on Deen, nowhere else, but it is
live.

## Hard-won lessons

The full incident record lives in `AGENTS.md` at the repo root — read it
before doing any non-trivial work here, especially before touching dates,
Server Component props, or the shared working tree. Summarized, the shape of
the mistakes this project keeps making:

- **A check that examines nothing reports success.** Three different checks
  passed "green" in one afternoon (2026-08-26) while measuring nothing
  meaningful — an overlap check against an empty table, a layout check that
  ran before the content it was checking for had rendered, and a filtered
  test run that silently skipped auth setup. The fix pattern each time: seed
  the fixture to the *shape* of the reported bug and confirm the check goes
  red before trusting it green.
- **A check can pass for the wrong reason**, which looks identical to the
  above in the log but is subtler: a hit-test-based stacking check
  (`document.elementFromPoint`) passed even with the bug re-introduced,
  because it was measuring pointer-events, not paint order. The rule: assert
  the actual property (computed z-index, measured box), not a
  realistic-*feeling* proxy for it — and re-introduce the bug at runtime to
  confirm a check actually catches it before trusting it.
- **The shared-working-tree race class.** Multiple engineers editing one
  `.git` index concurrently broke both naive commit strategies (`git commit
  -- <paths>` ignores the index and picks up others' unsaved edits; `git add`
  then `git commit` can be won by another agent's `git add` landing in the
  gap between). The fix is `scripts/agent-commit.sh`, a mkdir-mutex wrapper —
  always commit through it in this repo, never a bare `git add`/`git commit`.
  The same class of resource-sharing bug also hit the e2e environment
  itself (one SEED account, one `playwright/.auth/user.json`) when four
  agents ran Playwright concurrently — hence "only one agent runs Playwright
  at a time."
- **Calendar dates need a timezone, not just a `Date`.** Hit three times in
  one night in three different layers (app code, hand-written SQL, test
  fixtures) — see `AGENTS.md` for the full incident. The rule that survived
  it: a calendar date is a function of an instant *and* a timezone, never
  `new Date()`/`getUTCDate()`/`current_date` alone.

## How to keep this file current

This file is meant to be edited, not replaced wholesale. When you add to it:

- **Status section** — always overwrite in place; it should only ever
  describe the current moment. Update the "As of" date at the top whenever
  you touch it.
- **Recent work** — add new themes above the oldest ones you're keeping
  (newest-first), and prune anything more than ~6–8 weeks old to keep this
  from becoming a second `PROJECT_STATUS.md`. Group by theme, not by
  commit — a reader wants "what changed and why," and can always follow a
  cited commit hash back into `git log` for the blow-by-blow.
- **Known-open items** — before adding a new one, re-verify every existing
  entry against current code, the same way this pass did. Keep only the ones
  actually still open, and delete ones that verifiably got fixed — don't
  just append. This list is a liability the moment it's stale, since a
  future agent may act on a "known bug" that's already gone.
- **Dead code inventory** — the exact same warning applies, doubly. Before
  trusting or extending this list, re-verify each entry's import count with
  an exact-path grep (a substring match on the filename will produce false
  positives, as it did for `lib/fitness/consistency.ts` in this pass —
  confirm with the literal import path, e.g. `grep -rn
  "lib/fitness/consistency[\"']"`, not just the bare filename).
- If you can't verify a claim you're carrying forward from a prior version
  of this file, say so explicitly ("unverified as of <date>") rather than
  silently dropping the uncertainty. Silently dropping it is how a
  once-honest "unverified" item quietly becomes a "confirmed" one three
  edits later.
