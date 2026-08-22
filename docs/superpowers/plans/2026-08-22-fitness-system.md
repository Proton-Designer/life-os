# Fitness system rebuild — plan

**Verbatim requirements:** `docs/superpowers/specs/2026-08-22-fitness-system-REQUIREMENTS.md` (commit 55aa793). That file is the scope authority; this plan derives from it.

## Context

The fitness screen has never been used on either account. The diagnosis is structural, and exploration confirmed it is worse than it looked:

- **There is no plan entity in the database.** `SeedPlan` exists only as a TypeScript constant. Adopting a plan *flattens* it into N loose `workouts` rows named `"Plan A — Session A"` plus 5 `workout_schedule` upserts. Adopting a second plan does not remove the first's rows. Nothing can answer "which plan am I on."
- **The starter plan is invisible by construction.** 30 pull-ups / 100 push-ups is stored as two `rep_goals` rows. The workout list reads only the `workouts` table, so the active plan can never appear in it. Worse, with the starter adopted and no session plan, the list renders its *first-run empty state* — "you have nothing" directly beneath a banner saying the plan is active.
- **Logging lives on the wrong screen.** The only general "log anything" affordance in the app is `+ Quick log` on Home. Fitness can only confirm a workout pre-assigned to a weekday.

Outcome: workout plans become first-class, the Fitness screen becomes the place you actually train from, and Home keeps one line.

## Confirmed product decisions

| Decision | Ruling |
|---|---|
| Active plans | Two slots — one `micro`, one `routine`. Neither required. Zero, one, or both. |
| Session start time | **Optional.** With a time → renders at that hour. Without → "unscheduled" band at the top of the day. Micro exercises are always all-day bands. |
| Cycle | 4 weeks. Benchmarks at each boundary: weight, waist, max pull-ups, max push-ups. Shows delta vs previous cycle. |

## Architecture

### Compatibility shim — read this first

`workout_schedule` has **nine readers outside fitness** (`lib/home/get-weekly-completion.ts`, `get-domain-snapshots.ts`, `get-domain-pulse.ts`, `get-day-shape.ts`, `lib/checkins/get-checkin-options.ts`, `get-allocation-queue.ts`, `lib/notifications/get-notifications.ts`, `app/(app)/page.tsx`, `app/(app)/fitness/page.tsx`). Abandoning it breaks Home, check-ins, and notifications.

**Decision: keep it, as a derived projection.** On every plan activation *and* every edit of an active plan, re-sync `workout_schedule` from the active routine plan's sessions — `day_of_week`, `workout_name` = session name, `time` = `start_time`, `duration_minutes` = summed exercise durations, `workout_id` = null. Null `workout_id` is already a supported state (the legacy `setWorkoutSchedule` free-text path produces it). All nine readers keep working untouched.

This shim is the single highest-risk item in the build. It must be one function called from every mutation path, never duplicated.

### Schema — migrations 036–039

Reserved: **036, 037, 038, 039**. Highest existing is 035. Follow `027`/`029` conventions exactly: RLS enabled, one `<table>_own_row` policy `for all` with `(select auth.uid())`, `user_id` indexed, RPCs `security invoker` + `set search_path = public` + explicit `grant execute`.

**036_workout_plans.sql**
```sql
workout_plans        (id, user_id, name, kind check in ('micro','routine'), archived, created_at)
                     unique (user_id, lower(name)) where not archived

plan_micro_exercises (id, user_id, plan_id → workout_plans on delete cascade, exercise_id → exercises,
                      position, schedule_days int[] not null default '{1,2,3,4,5}',
                      goal_type check in ('daily_total','frequency'), goal_value int > 0, notes text)
                     unique (plan_id, position)

plan_sessions        (id, user_id, plan_id → workout_plans on delete cascade, name, position,
                      schedule_days int[] not null, start_time time NULL)
                     unique (plan_id, position)

plan_session_exercises (id, user_id, session_id → plan_sessions on delete cascade, exercise_id → exercises,
                      position, duration_minutes int not null > 0,
                      load_lb numeric NULL, target_sets int NULL, target_reps int NULL)
                     unique (session_id, position)
```
`schedule_days` is `int[]` of 0=Sun..6=Sat, matching the repo-wide convention. Presets (everyday / weekdays / weekends / M-W / T-Th / custom) are a **UI concern only** — they expand to a day array on save. Do not store the preset name.

**037_active_workout_plans.sql**
```sql
active_workout_plans (user_id primary key, micro_plan_id → workout_plans on delete set null,
                      routine_plan_id → workout_plans on delete set null, updated_at)
```
`on delete set null` is deliberate: deleting an active plan deactivates the slot rather than erroring. The UI confirm must name that consequence.

**038_plan_session_confirmations.sql**
```sql
alter table workout_sessions add column plan_session_id uuid null references plan_sessions(id);
create unique index workout_sessions_plan_session_unique
  on workout_sessions (user_id, date, plan_session_id)
  where source = 'confirmed' and plan_session_id is not null;
```
Mirrors the existing `workout_sessions_confirmed_unique` idempotency pattern from `029`.

**039_fitness_cycles.sql**
```sql
fitness_cycle_anchor (user_id primary key, anchor_date date not null, created_at)
fitness_benchmarks   (id, user_id, date, exercise_id → exercises NULL, max_reps int >= 0)
                     unique (user_id, date, exercise_id)
```
Weight and waist are **not** duplicated here — `body_metrics` already holds them with `unique (user_id, date)`. Benchmarks only store max-effort rep tests.

**No new table for micro progress.** Both goal types derive from existing rows:
- `daily_total` → `SUM(sets × reps)` of today's `session_sets` for that exercise
- `frequency` → `COUNT` of today's `session_sets` rows for that exercise (each log is one bout; reps still recorded so volume math stays correct)

### Pure libraries (no React, no I/O — the repo's `lib/checkins/schedule.ts` pattern)

- `lib/fitness/plan-schedule.ts` — `expandPlanToWeek(plan, weekDates)` → per-day items. `SCHEDULE_PRESETS` → day-array expansion.
- `lib/fitness/cycle.ts` — `CYCLE_LENGTH_DAYS = 28`; `cycleForDate(anchorDate, dateStr)` → `{ cycleNumber, startDate, endDate, daysLeft }`. Anchor stored once (defaults to first plan activation). Pure function over a stored table — same reasoning as `computeAllocationWindows`.
- `lib/fitness/daily-log.ts` — merges all six item archetypes into one ordered list with completion state.
- `lib/fitness/week-status.ts` — `completed | active | upcoming | missed`.

### Type contract — both engineers code against this from hour one

```ts
export type DailyLogItem =
  | { kind: "micro_total";  exerciseId: string; name: string; logged: number; target: number; notes: string | null }
  | { kind: "micro_freq";   exerciseId: string; name: string; bouts: number;  target: number; notes: string | null }
  | { kind: "session";      sessionId: string;  name: string; durationMinutes: number; startTime: string | null; confirmed: boolean }
  | { kind: "daily_check";  checkKind: "protein" | "steps"; done: boolean }
  | { kind: "body_metric";  metric: "weight" | "waist"; lastValue: number | null; lastDate: string | null }
  | { kind: "benchmark";    cycleNumber: number; dueBy: string };

export type WeekDayStatus = "completed" | "active" | "upcoming" | "missed";
```

### Daily Log — every archetype and its tap behaviour

| Archetype | Tap opens | Captures | Completion |
|---|---|---|---|
| `micro_total` | inline reps entry, prefilled with usual bout size | reps | `SUM ≥ target` → row disappears |
| `micro_freq` | inline reps entry | reps (for volume) + one bout | `bouts ≥ target` |
| `session` | expands existing `SessionDetailPanel` in place | per-exercise sets/reps/load, all visible and editable | single Confirm (never a bare tap — spec §2.1) |
| `daily_check` | toggles immediately | boolean | binary |
| `body_metric` | inline numeric entry | weight or waist | one entry that day; waist re-arms after 14 days |
| `benchmark` | benchmark form | weight, waist, max pull-ups, max push-ups | appears only in the last 3 days of a cycle |

Micro items list individually. Routine sessions list **as a whole**, never exploded into exercises.

### Screens

**Fitness** — four modules top to bottom:
1. **Workout Plan** strip — `Workout Plan: {micro} + {routine}` or `none selected`, with `My Workouts →` on the right.
2. **Daily Log** — replaces and absorbs the current Daily checks panel.
3. **This week** — merges the current `This week` and `Sessions` panels. Real Sun–Sat dates, live status including `missed`.
4. **Cycle Progress checks** — absorbs the Body panel. Current stats + delta vs previous cycle + `Log cycle benchmarks`.

**My Workouts** (`/fitness/workouts`):
1. Currently active (both slots).
2. Plan list, each row with Edit / Delete / Activate. Save appears while editing.
3. `+ Create workout` → name → **micro | routine** fork → builder.
4. Builder carries a generic Sun–Sat week preview that updates live as items are added.
5. Bottom: detailed hourly Sun–Sat calendar. Defaults to the active plan; tapping a plan in the list previews it temporarily. Reuse `pctOf` from `lib/home/day-ribbon.ts` — the only time-positioning math in the repo.

**Home** — `HomeFitnessPanel` and `HomeOnPlanCard` are removed from `app/(app)/page.tsx`. Now gains one fitness row: icon, `Fitness`, and today's workout name. Tapping navigates to `/fitness`. Nothing else.

## Logic gaps in the requirements, and their resolutions

1. **Editing a plan that is currently active, mid-week** — edits apply forward only. Logged history is immutable; `session_sets` already snapshots `exercise_name`. Re-sync the `workout_schedule` shim on save.
2. **Deleting an active plan** — allowed; `on delete set null` clears the slot. The confirm dialog must say "this is your active plan."
3. **`This week` has no MISSED state** — the requirements name completed / active / upcoming only. Missed is the accountability-critical one and is added.
4. **Frequency-goal bouts must record reps**, not just increment a counter, or weekly volume silently under-counts.
5. **Micro and routine items on the same day** — both render; micro first (all-day), sessions after.
6. **Cycle module needs an anchor before it can render** — default the anchor to the first plan activation date.
7. **`StarterPlanToggle` becomes obsolete** — delete it once the starter is a real micro plan.
8. **Seed plans A/B/C** — `adoptSessionPlan` is rewritten to create a real `routine` plan rather than flattening into loose workouts.

## Data migration (idempotent, in 036)

Existing `rep_goals` rows become a `micro` plan named **"Starter Reps"**, activated in the micro slot, with `goal_type = 'daily_total'` and `schedule_days` from `active_days`. Existing loose `workouts` rows are left alone — they remain valid quick-log targets and history; they are not auto-converted.

## Team split

Peers (implementation only — no review or analysis tasks):

**Engineer A — `jazdm6pt`** (deepest fitness context: seed plans, volume, Phase 6/7)
- Phase 1: migrations 036–039, `database.types.ts`, all four pure libs, data migration, rewrite of `adoptSessionPlan`/`adoptStarterPlan`, the `workout_schedule` sync function.
- Phase 3: Fitness screen — all four modules.

**Engineer B — `lorzr3x4`** (shell/Home/UI context: bell, topbar, Body panel move)
- Phase 2: My Workouts rebuild — list, create fork, builder, live week preview, hourly calendar.
- Phase 4: Home Now row + removal of the Home fitness panel.

Phase 2 depends only on the **type contract above**, not on Phase 1 landing — B starts immediately against those interfaces.

## Constraints both engineers must obey

- **RSC boundary** (`AGENTS.md`): never pass a plain function from a Server to a Client Component. Server Actions via `.bind(null, arg)`. Not caught by `tsc` or vitest — verify in a live browser console.
- **Shared working tree.** `git diff HEAD -- <path>` on *every* file before staging; a file that is legitimately yours can already carry another engineer's uncommitted hunk. Read the full unfiltered `git status --short`, never a grep. Pathspec-limit every commit. Never stash or reset.
- **Verify from a clean worktree** whenever the tree is dirty. In-tree green checks proved worthless on 2026-08-20 — `tsc` passed only because another engineer's uncommitted work was supplying a missing type.
- **Pre-commit hook blocks >15 staged files**; `ALLOW_WIDE_COMMIT=1` is the documented override, only for legitimately wide commits.
- **Deploys**: `docs/DEPLOYING.md`. Ancestry check before shipping; tell me first so I sequence it.

## Verification

- Unit: pure libs get adversarial inputs, not just valid ones (`PROJECT_STATUS.md` precedent — NaN, negative, empty, unknown enum). Cycle math across a DST boundary. `expandPlanToWeek` for every preset.
- Timezone: any calendar date derived with `localDateString(now, profile.timezone)`, never UTC. This class of bug has already shipped twice.
- RLS: verify by real impersonation (`SET LOCAL ROLE authenticated` + a different `sub`), not by reading the policy.
- Idempotency: confirm the same session twice concurrently; adopt the same plan twice.
- **The shim**: after activating, editing, and deleting a plan, assert `workout_schedule` still yields correct results for all nine readers. Home, check-ins, and notifications must be loaded in a browser and checked.
- E2E: there is currently **no** `e2e/fitness.spec.ts`. Add one covering create → activate → log → confirm.
