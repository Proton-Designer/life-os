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
| 1a | Home: "Today's Schedule" subtitle + event count | A | BACKLOG | Replaces "Today's 5 prayers are accounted for" |
| 1b | Home: day-ribbon blobs sized to real duration | A | BACKLOG | Currently uniform width; must match the time axis |
| 2 | Cross-device live sync (prayers, tasks, everywhere) | A | BACKLOG | Root cause known — see Ruling R1 |
| 3 | Fitness: drop protein/steps/weight/waist from Daily Log | A | DONE | Weight/waist relocated to CycleProgressPanel/BodyModule as on-demand log (no task semantics). Lead caught a real regression on first pass: the two custom_habits rows (protein/steps) stayed live and unarchived, feeding Home's fitness pulse/snapshot denominator with no way left to complete them — archived on SEED, applied to real account by Lead; toggleDailyCheck/ensureDailyCheckHabits + the clear-daily-check test route deleted outright, confirmed via grep nothing can recreate the rows |
| 4 | Work schedule: today highlight, edit-hours popup, real times | B | DEV | Also verify "Cancel this week" actually works |
| 5 | School: unified Task list (4 groups, filters, add wizard, edit popup) | B | TEST | Wizard (6bea95d) + module/migration 050 (87119ee) landed; tsc/vitest clean, live-verifying next |
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
