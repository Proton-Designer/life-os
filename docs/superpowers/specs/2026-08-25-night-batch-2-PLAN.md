# 2026-08-25 night batch 2 — plan and live task board

Scope authority is `2026-08-25-night-batch-2-VERBATIM.md`. This file holds the
rulings, the ownership map, and the status board. **Engineers: update your own
rows' status as you go.**

Status vocabulary: `BACKLOG` → `DEV` → `TEST` → `VERIFY` → `ITERATE` → `DONE`

---

## Board

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| 0 | Batch-1 deploy (11 commits, `2aafd7a`) | Lead | BACKLOG | Ayman authorized auto-deploy; ships together with batch 2 at the end |
| 1a | Home: "Today's Schedule" subtitle + event count | A | DONE | Subtitle is now a static class+work summary (Ayman's 4 worked cases, plus an honest empty state), not time/prayer-status narration — verified live "You have 3 classes today" on Tuesday SEED data |
| 1b | Home: day-ribbon blobs sized to real duration | A | DONE | Math was already correct (proportional to real duration); the bug was a 28px CSS minWidth ≈63 real minutes on a ~24h range, clamping nearly every real class/task/fitness block to the identical floor — dropped to 8px (≈18min). Blocks also now sorted by real start time (were grouped by data source, not chronology) |
| 2 | Cross-device live sync (prayers, tasks, everywhere) | A | BACKLOG | Root cause known — see Ruling R1 |
| 3 | Fitness: drop protein/steps/weight/waist from Daily Log | A | DONE | Weight/waist relocated to CycleProgressPanel/BodyModule as on-demand log (no task semantics). Lead caught a real regression on first pass: the two custom_habits rows (protein/steps) stayed live and unarchived, feeding Home's fitness pulse/snapshot denominator with no way left to complete them — archived on SEED, applied to real account by Lead; toggleDailyCheck/ensureDailyCheckHabits + the clear-daily-check test route deleted outright, confirmed via grep nothing can recreate the rows |
| 4 | Work schedule: today highlight, edit-hours popup, real times | B | DEV | Also verify "Cancel this week" actually works |
| 5 | School: unified Task list (4 groups, filters, add wizard, edit popup) | B | VERIFY | Wizard (6bea95d) + module/migration 050 (87119ee) landed; live-verified against SEED (wizard 3-step flow incl. date chip, grouping/KPI update, Edit-dialog remove) — console clean, DB state confirmed via psql, test task cleaned up |
| 6a | Schema: `classes`, `class_assessments`, syllabus storage bucket | C | BACKLOG | Migration 048 + first Supabase Storage bucket in the app |
| 6b | School: per-class cards grid | C | BACKLOG | Six classes, data-driven |
| 6c | School: expanded class view (assessments, syllabus, class task list) | C | BACKLOG | Reuses B's wizard from item 5 |
| 7 | Full-batch verification (tsc, vitest, e2e, browser) | A | BACKLOG | After all of 1-6 |
| 8 | Deploy + verify against deployment + kill caffeinate | Lead | BACKLOG | Ayman's explicit final instruction |

---

## Rulings

### R1 — Item 2's root cause is already documented in our own config
`next.config.ts` sets `staleTimes.dynamic = 3600` with a comment that ends:
*"Client cache is per-browser-session, not shared across users/devices."*

That is exactly the reported bug. A mutation on the phone calls `revalidatePath()`,
which busts the **server** cache. The laptop holds an **independent client Router
Cache** that will keep serving its own snapshot for up to an hour and never
re-requests. `revalidatePath` cannot reach another device. Nothing is broken;
nothing was ever built to do this.

**Fix: Supabase Realtime.** Add the mutable tables to the `supabase_realtime`
publication (currently empty — zero tables), subscribe client-side filtered to
the signed-in `user_id`, and call `router.refresh()` on change. Also lower
`staleTimes.dynamic` so a missed realtime event self-heals in minutes rather than
an hour. Realtime is the mechanism; the staleTimes reduction is the safety net.
Do NOT rely on polling — "right away" is the requirement.

### R2 — Classes must become a real entity (item 6)
Today a "class" is only N rows in `schedule_events` sharing a `class_group_id`
(migration 046, tonight). Item 6 needs a class to own an abbreviation, a syllabus
file, and a list of assessments. That is an entity, not a label.

Migration 048 introduces `classes`; `schedule_events.class_id` references it, and
`class_group_id` is migrated into it and deprecated in place (same pattern as
`cancelled_on` — do not drop).

### R3 — The class list is DATA-DRIVEN, never hardcoded
Ayman named six classes. His account currently has **five** distinct course codes
in `schedule_events` (AMS-2341-HN1, CS-3341-HON, CS-3345-HON, PHYS-2126-105,
PHYS-2326-002). **MATH 2418 (Lin Alg) does not exist in his data at all.**
Item 5 also says "one of the 5 classes I'm taking" while item 6 lists six — the
six is authoritative, the five is a stale count.

Cards render from the `classes` table. MATH 2418 gets a row so its card appears,
but its meeting times/room/instructor are unknown and cannot be invented — that
is flagged to Ayman, not guessed.

### R4 — The add-task wizard is built ONCE (items 5 and 6c)
Item 6 says class tasks are added "in the same manner as how tasks are added in
the new task list setup I explained in step 5." B builds it as a standalone,
reusable component with a narrow prop contract; C consumes it. It is not
reimplemented in the class view.

### R5 — Assessments create tasks (item 6c)
"whenever somethign is added in the assessment tab it shoudl atuomatcially be
added inside the indivual class task lists as well as the main task list."
An assessment write creates the assessment row AND its linked task in one
transaction. The task carries `class_id` and its type, so both lists pick it up
with no extra sync logic. Deleting an assessment must not orphan the task.

### R6 — Task type colors are one shared map
Both item 5 and item 6c say "each task type should be a different text color."
One exported token map, used by both. Must satisfy contrast in light and dark
and must not rely on hue alone as the sole differentiator (type text is also
always present as a label, which satisfies this).

---

## Ownership map — no crossing without Lead approval

**A** — `components/home/**`, `lib/home/**`, `components/fitness/**`,
`app/(app)/fitness/**`, `next.config.ts`, realtime hook/provider (new),
`supabase/migrations/049_*` (realtime publication), `e2e/**`

**B** — `app/(app)/school/**`, `components/school/**` (except the class-card and
class-view files C creates), `app/(app)/work/**`, `components/shared/domain-schedule-view.tsx`,
`lib/tasks/**`, `supabase/migrations/050_*`

**C** — `components/school/class-card.tsx`, `class-detail-dialog.tsx`,
`class-assessments.tsx`, `syllabus-*.tsx` (all new), `lib/school/**` (new),
`supabase/migrations/048_*`, storage bucket setup

**Shared, hand-edit your own block only, NOBODY runs the generator:**
`lib/supabase/database.types.ts`

Migration numbers: **048 = C, 049 = A, 050 = B.**

---

# Batch 3 — added 2026-08-25 23:24 CDT

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| B3-1 | Topbar: date to left; Check-in icon top right; order Check-in / Calendar / Notifications | B | BACKLOG | Remove the 2h window entirely; glow every 2h instead |
| B3-2 | Deen: "Salah today" → "Salah" + View More monthly calendar (#/5 rings, day → edit) | C | BACKLOG | Scrollable past/future months |
| B3-3 | Business: kill list View More (week/month/3mo) + "Incompleted this Week" | B | BACKLOG | Day → items popup, status editable |
| B3-4 | **Fresh-start data wipe of Ayman's real account** | Lead | BACKLOG | Destructive. See R7. Runs AFTER all verification, BEFORE deploy |

## R7 — the data wipe is destructive and irreversible; back it up first

Ayman explicitly and specifically authorized this, listing what goes and what
stays. It is not a judgement call and it is not to be second-guessed. But it is
irreversible, it targets his **real production account**, and there is no staging
copy of that data anywhere.

**Therefore: `pg_dump` the affected tables to a local file BEFORE deleting
anything.** If he wakes up and says "actually I wanted my prayer streak," the
answer must not be "it's gone." The backup is not a reason to be careless — it's
the cheap insurance that makes a one-way door reversible for a few hours.

**REMOVE (his account; SEED gets the same treatment so the two stay comparable):**
- all weekly goals, current and past
- all prayer data — `prayers`, sunnah logs, qada log, streaks
- all habits and their logs/insights/progress (`deen_habits`, `deen_habit_logs`,
  `custom_habits`, `habit_logs`, `deen_weekly_focus`)
- all reflections
- all past fitness *progress* — sessions, sets, body metrics, benchmarks, cycles
- all kill-list data

**KEEP — explicitly named by him, do not touch:**
- school classes (`classes`, `schedule_events` for school) — "set in stone"
- work schedule (`schedule_events` for work)
- **fitness PLANS** (`workout_plans`, `plan_sessions`, `plan_session_exercises`,
  `plan_micro_exercises`, `active_workout_plans`, `exercises`) — "keep the fitness
  plans though, just not the progress"
- the profile itself, and anything else not named above

**"Start counting from tomorrow"** is a consequence of empty history, not a
setting to write. Delete the rows; do not fabricate an epoch/start-date column.

Verify with before/after row counts per table, and confirm the KEEP list is
untouched by counting those too.

## R8 — commit discipline corrected (2026-08-25 23:24)

`git commit -m "msg" -- <paths>` **ignores the index** and commits working-tree
state for those paths. My earlier standing instruction to always use that form
was wrong; it caused one cross-engineer misattribution tonight (`87119ee`).

**Correct flow for everyone, for the rest of this project:**

    git add <explicit paths>
    git diff --cached          # authoritative — exactly what will be committed
    git commit -m "msg"        # NO pathspec

The index is a snapshot: once staged, a concurrent save by another engineer into
one of your files cannot enter your commit. A pathspec commit has no snapshot.

---

# PAUSE — 2026-08-25 23:31 CDT (usage limit at 92%, resets 01:50)

Work suspended by Ayman. Resume shortly after **01:52 CDT**. Lead holds a
background timer that re-invokes the session; engineers idle until pinged.

## Landed tonight (batch 1 + batch 2 so far)

Batch 1: `959dd4e` `4c3859a` `e3adf5b` `5c1b16b` `959234a` `8a00ea2` `de6ea10`
`36ccfc6` `8e74bb7` `71f529f` `18410c2` `2aafd7a` `12723f5` `049bcd9` `8979750`
Batch 2: `c2f1170` (docs) `05a4e04`+`48d0f10` (item 3) `98889b5` (1a/1b)
`6bea95d`+`87119ee` (item 5 + migration 050) `36240be` (048) `6331073` (item 6)
`45160c4` (batch-3 docs + AGENTS.md pathspec trap)

Production is still on `3b31fda`. **Nothing has been deployed all night.**

## Live DB state — schema is AHEAD of deployed code

Applied by hand to the single shared production database: **046, 047, 048, 050**,
plus B's `schedule_event_overrides` (**migration file may not be committed yet —
verify on resume, this is the highest-risk loose end**). All additive, so the
currently-deployed build is unaffected.

Data changes already applied to BOTH accounts:
- stale `cancelled_on` cleared (the Mengke Liu bug)
- `classes` backfilled + `short_name` seeded + MATH 2418 inserted (nulls)
- `custom_habits` protein/steps archived (orphaned Home denominator)

## Remaining queue on resume

**Lead first:** verify B's override migration file exists and matches what was run.

**C (first — gates the wipe):** migration 051 `profiles.tracking_started_on date null`;
floor becomes `coalesce(tracking_started_on, created_at local date)` in
`lib/deen/prayer-status.ts`, `app/(app)/deen/page.tsx`, and — under a one-commit
lock on A's file — `lib/home/get-domain-snapshots.ts` (lines 366, 469).
Then B3-2 (Salah calendar), then B3-3 (kill list).

**A:** item 1b tap-target fix (8px buttons + clipped icon), then item 2 (realtime,
migration 049) — the long pole.

**B:** finish item 4 (shared occurrence resolver + precedence tests + the
Cancel-this-week verdict), then B3-1 (topbar + check-in diagnosis).

**Lead last:** R7 wipe (pg_dump first, set `tracking_started_on` = 2026-08-26),
then full verification, then deploy, then kill `caffeinate`.

## R7 CORRECTED — an epoch column IS required

My original R7 said "delete the rows; do not fabricate an epoch/start-date
column." **That was wrong and C proved it.** `resolvePrayerStatuses` derives
`missed` from an absent row for any past day above its floor, and that floor is
`profiles.created_at` = **2026-08-10, 16 days ago**. Deleting every `prayers` row
would render **80 missed prayers** across the consistency grid, streak and qada
backlog — manufacturing exactly the false history the wipe exists to remove
(Ayman: *"i dont wanna lie, isntead i wanna start fresh"*).

Deletion alone cannot express "start counting from tomorrow" in a system that
derives failure from absence. The epoch column is required. Set it to his local
tomorrow (2026-08-26) as part of the wipe.

Checked and NOT a problem: the same "keep the plan, delete the progress" shape
could synthesize missed *workouts*, but his account has 1 active plan and **zero
`plan_sessions`**, so no past day has a scheduled session to derive a miss from.
