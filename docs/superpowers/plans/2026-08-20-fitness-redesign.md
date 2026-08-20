# Fitness Redesign Implementation Plan

> **For agentic workers:** Each task below is owned by a named engineer. Within a
> task, follow the project's normal TDD loop (failing test → minimal
> implementation → green → commit). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace an attendance tracker that has never been used with a training
tracker whose daily cost is one tap, built around plans that carry their own
structure.

**Architecture:** The plan holds ordered exercises with target sets/reps/load.
Logging is *confirmation* that copies those values into an immutable session
snapshot. Weekly volume per muscle group is computed from a live
exercise→muscle-group join. A separate, orthogonal daily-rep-goal object powers
the starter plan on Home.

**Tech Stack:** Next.js 16.3 App Router, Supabase (Postgres + RLS), TypeScript,
vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-19-fitness-redesign.md` — read it
before starting. Every "why" lives there; this document is the "what" and "in
what order."

## Global Constraints

Copied verbatim from the spec. **Every task's requirements implicitly include
this section.**

- **NO LEG TRAINING.** All plan content is upper-body and core only (spec §8).
- **Never pass a function as a prop from a Server Component to a Client
  Component** (AGENTS.md). Use `action.bind(null, arg)` or a plain serializable
  value. `tsc` and `vitest` do NOT catch this — verify in a browser.
- **Never `git add -A` / `git commit -a`.** Three agents share one working
  directory. Stage explicit paths only.
- **Archive, never hard-delete** any user content row.
- **Logged sessions are immutable snapshots.** Editing a template must never
  rewrite history.
- **Muscle-group tags are a LIVE join**, not a snapshot. Sets/reps/load snapshot;
  tags do not.
- **Copy constraints (hard, not style):** the protein gram number appears once as
  a non-interactive caption — never in a progress bar, never "X of Y g". The step
  checkbox must not imply a synced pedometer. Nothing sums or logs grams.
- **No streak anywhere on this screen.** Adherence is a fraction.
- **Bodyweight always displays as a 7-day rolling average**, never the raw daily
  reading. Weight and waist are one module and always render together.
- **44×44 minimum tap targets; must not overflow at 390px.**
- Commit hooks: `docs:`-prefixed commits may stage only `*.md`; >15 files needs
  `ALLOW_WIDE_COMMIT=1`.

## Ownership

| Phase | Owner | Depends on |
|---|---|---|
| 1. Schema + RLS | Engineer 3 (jazdm6pt) | — |
| 2. Pure libs (volume, progression, rollup) | Engineer 3 | 1 |
| 3. Workout library UI | Engineer 2 (lorzr3x4) | 1, 2 |
| 4. Fitness screen restructure | Engineer 2 | 1, 2 |
| 5. Home surfaces + Body module + checks | Engineer 2 | 1, 2 |
| 6. Seed plans + adoption | Engineer 3 | 1, 2 |
| 7. Deletions + rewiring | Engineer 3 | 4 |

Phases 3–5 and 6–7 run concurrently once 1–2 land. **Phase 1 blocks everything;
it ships first and alone.**

---

## Phase 1 — Schema and RLS (Engineer 3)

**Files:**
- Create: `supabase/migrations/024_fitness_exercises_and_workouts.sql`
- Create: `supabase/migrations/025_fitness_sessions.sql`
- Create: `supabase/migrations/026_fitness_rep_goals_and_body_metrics.sql`
- Modify: `lib/supabase/database.types.ts` (regenerate)

**Interfaces produced** (later phases depend on these exact names):

```sql
-- 024
exercises(id uuid pk, user_id uuid not null default auth.uid(),
          name text not null,
          primary_muscles text[] not null default '{}',
          secondary_muscles text[] not null default '{}',
          archived boolean not null default false,
          created_at timestamptz not null default now())
  unique (user_id, lower(name)) where not archived

workouts(id uuid pk, user_id uuid, name text not null,
         archived boolean not null default false, created_at timestamptz)

workout_exercises(id uuid pk, workout_id uuid references workouts on delete cascade,
                  user_id uuid, exercise_id uuid references exercises,
                  position int not null,
                  target_sets int not null check (target_sets between 1 and 20),
                  target_reps_low int not null, target_reps_high int not null,
                  target_load numeric null)
  unique (workout_id, position)

-- workout_schedule gains a nullable pointer; workout_name stays for legacy rows
alter table workout_schedule add column workout_id uuid references workouts

-- 025 — immutable snapshots
workout_sessions(id uuid pk, user_id uuid, date date not null,
                 workout_id uuid null references workouts on delete set null,
                 workout_name text null,
                 source text not null check (source in ('confirmed','adhoc','quick')),
                 created_at timestamptz not null default now())

session_sets(id uuid pk, session_id uuid references workout_sessions on delete cascade,
             user_id uuid, exercise_id uuid null references exercises on delete set null,
             exercise_name text not null,   -- snapshot; survives exercise deletion
             position int not null,
             sets int not null, reps int not null, load numeric null)

-- 026
rep_goals(id uuid pk, user_id uuid, exercise_id uuid references exercises,
          daily_target int not null check (daily_target > 0),
          active_days int[] not null default '{1,2,3,4,5}',  -- 0=Sun
          archived boolean not null default false)
  unique (user_id, exercise_id) where not archived

body_metrics(id uuid pk, user_id uuid, date date not null,
             weight_lb numeric null, waist_in numeric null)
  unique (user_id, date)
  check (weight_lb is not null or waist_in is not null)
```

- [ ] **Step 1:** Write the three migrations. Every table gets
  `alter table … enable row level security` plus a single
  `user_id = (select auth.uid())` policy, matching the exact shape used by
  `workout_logs` (`\d workout_logs` shows the convention).
- [ ] **Step 2:** Apply them. Verify RLS by **real impersonation**, not by
  assuming: `SET LOCAL ROLE authenticated` with a different `sub` claim, confirm
  zero rows visible and inserts rejected. This is the project's standing bar —
  a policy that has not been impersonation-tested is not verified.
- [ ] **Step 3:** Confirm the `body_metrics` check constraint actually rejects a
  row with both columns null.
- [ ] **Step 4:** Confirm the partial unique index on `rep_goals` permits an
  archived duplicate but rejects an active one.
- [ ] **Step 5:** Regenerate `database.types.ts`. Commit migrations + types
  together.

**Acceptance:** all three migrations applied; impersonation shows no
cross-user leakage on any of the six new tables; `tsc` clean.

**Do NOT** drop `workout_logs` in this phase. Phase 7 owns removal, after the
new path is proven.

---

## Phase 2 — Pure libraries (Engineer 3)

No database access, no React. Pure functions, exhaustively unit-tested. This is
the phase where the arithmetic gets locked down, so property-test it — the
`lib/checkins/allocation.ts` precedent (50k adversarial ops, which caught a real
NaN corruption their example-based tests missed) is the bar.

**Files:**
- Create: `lib/fitness/volume.ts`, `lib/fitness/__tests__/volume.test.ts`
- Create: `lib/fitness/progression.ts`, `lib/fitness/__tests__/progression.test.ts`
- Create: `lib/fitness/rep-goal.ts`, `lib/fitness/__tests__/rep-goal.test.ts`

**Interfaces produced:**

```ts
// volume.ts
export type MuscleGroup =
  | "chest" | "back_lats" | "back_mid" | "front_delt" | "side_delt"
  | "rear_delt" | "biceps" | "triceps" | "core";

export type SetEntry = {
  sets: number;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};

/**
 * Fractional crediting (spec §8): primary mover = 1 set, secondary = 0.5.
 * Returns a full record — every MuscleGroup key present, zero where untouched,
 * so callers never branch on undefined.
 */
export function weeklyVolume(entries: SetEntry[]): Record<MuscleGroup, number>;

/** Entries whose muscle arrays are BOTH empty contribute nothing and are counted here instead. */
export function untaggedCount(entries: SetEntry[]): number;

// progression.ts
/**
 * Next session's proposed load off the last confirmed top set.
 * Returns null when there is no history or the exercise is unloaded
 * (bodyweight) — the caller renders "—", never a fabricated number.
 */
export function proposeNextLoad(
  lastTopSet: { load: number | null; reps: number; targetRepsHigh: number } | null
): number | null;

// rep-goal.ts
export function repGoalProgress(
  loggedRepsToday: number,
  dailyTarget: number
): { done: number; target: number; fraction: number; complete: boolean };

/** 0=Sun … 6=Sat. */
export function isGoalActiveOn(activeDays: number[], dayOfWeek: number): boolean;
```

- [ ] **Step 1:** Write failing tests first for each function.
- [ ] **Step 2:** Property test `weeklyVolume` over ≥20,000 randomized entries.
  Invariants that must hold: result is never negative; result equals
  `sum(sets)` when every entry has exactly one primary and no secondary; an
  entry with N secondaries contributes exactly `0.5 * sets * N`; adding an
  entry never decreases any group's total.
- [ ] **Step 3:** Adversarial inputs explicitly — `NaN`, `Infinity`, `-0`,
  negative sets, duplicate muscles within one array, the same muscle listed as
  both primary and secondary. **Decide and document** what each does; do not let
  behaviour be accidental. My ruling: a muscle appearing in both arrays credits
  1.0, not 1.5 — it is one movement, and the primary classification wins.
- [ ] **Step 4:** `proposeNextLoad` — proposes an increment only when the last
  top set hit `targetRepsHigh`; otherwise repeats the same load. Returns null on
  null input or null load. Never returns `NaN`.
- [ ] **Step 5:** Green, then commit.

**Acceptance:** 100% branch coverage on all three modules; property tests
present and passing; no function can return `NaN` or `undefined` for any input.

---

## Phase 3 — Workout library UI (Engineer 2)

Spec §4. **Files:**
- Create: `app/(app)/fitness/workouts/page.tsx`
- Create: `app/(app)/fitness/workouts/actions.ts`
- Create: `components/fitness/workout-builder.tsx`
- Create: `components/fitness/workout-list.tsx`
- Create: `components/fitness/exercise-picker.tsx`

**Interfaces consumed:** Phase 1 tables; `MuscleGroup` from `lib/fitness/volume.ts`.

- [ ] **Step 1:** `workout-list.tsx` — saved workouts with row actions:
  duplicate, rename, **archive (never delete)**. Empty state offers the two
  equal-weight first-run entries from spec §4.1.
- [ ] **Step 2:** `exercise-picker.tsx` — search over the user's exercises with
  an inline "add new exercise" that captures name + multi-select primary and
  secondary muscle groups. **Saving untagged must be allowed** (spec §4); do not
  gate the save button on tags.
- [ ] **Step 3:** `workout-builder.tsx` — add/reorder (drag)/remove exercises,
  each with target sets, a reps range, and optional target load. Reorder writes
  `position`; the `unique (workout_id, position)` constraint means reordering
  needs a deferred or two-phase update — handle it, don't fight it with retries.
- [ ] **Step 4:** Server actions in `actions.ts`. Every action re-checks
  ownership; never trust an id from the client.
- [ ] **Step 5:** Show the live weekly volume of the workout being built, using
  `weeklyVolume`, plus the untagged note ("3 exercises aren't counted in your
  volume") from `untaggedCount`. **Passive, never a nag, never blocking.**
- [ ] **Step 6:** Verify at 390px and 1600px. Verify in a real browser for the
  RSC function-prop rule.

**Acceptance:** a workout can be created, reordered, duplicated, archived, and
its volume reads correctly; archiving preserves history; nothing overflows at
390px; zero console errors.

---

## Phase 4 — Fitness screen restructure (Engineer 2)

Spec §3. **Files:**
- Modify: `app/(app)/fitness/page.tsx` (substantial rewrite)
- Create: `components/fitness/day-picker-strip.tsx`
- Create: `components/fitness/session-detail-panel.tsx`
- Create: `components/fitness/volume-hero.tsx`
- Modify: `app/(app)/fitness/actions.ts`

- [ ] **Step 1:** `day-picker-strip.tsx` — **five cells, Mon–Fri only.**
  Navigation, not information display: small, secondary, today emphasised. Cells
  reference a workout by id.
- [ ] **Step 2:** `session-detail-panel.tsx` — defaults to today, tappable to any
  weekday. Renders the assigned workout's exercises with **the actual numbers
  inline** (`3×8 @ 135 — confirm?`).
- [ ] **Step 3:** The confirm action. **Hard requirements from spec §2.1:**
  - No bare "Confirm" button that can be tapped without numbers visible.
  - No auto-advance between exercises.
  - Adjusting is a stepper already on screen, not a separate flow.
  - Confirming **copies** target values into `workout_sessions` +
    `session_sets`, including `exercise_name` as a text snapshot.
- [ ] **Step 4:** Idempotency. Two confirms for the same (user, date, workout)
  must not double-write. Use a partial unique index plus an RPC that treats the
  conflict as success and returns the existing id — the exact pattern in
  `022_save_allocation_checkin_idempotent.sql`. **Prove it with two real calls,
  not a unit test.**
- [ ] **Step 5:** `volume-hero.tsx` — weekly sets per muscle group against
  target, plus an adherence **fraction** ("4/5 this week"). No streak.
- [ ] **Step 6:** Wire the page. Delete the old `TodayWorkoutCard`, both KPI
  cards, the `Habits` panel and the `AdhocWorkoutForm` from this page (their
  files are Phase 7's problem, not yours — just stop rendering them here).

**Acceptance:** confirm writes a correct immutable snapshot; a second confirm is
a no-op returning the same row (proven live); editing the source workout
afterwards leaves the snapshot unchanged (proven live); no streak appears
anywhere; 390px clean.

---

## Phase 5 — Home surfaces, Body module, daily checks (Engineer 2)

Spec §5, §6, §7. **Files:**
- Create: `components/fitness/rep-goal-bars.tsx`
- Create: `components/fitness/quick-add-sheet.tsx`
- Create: `components/fitness/body-module.tsx`
- Create: `components/fitness/daily-checks.tsx`
- Modify: `app/(app)/page.tsx` (Home), `lib/home/get-domain-snapshots.ts`

- [ ] **Step 1:** `rep-goal-bars.tsx` on Home — two thin bars ("Pull-ups 18/30"),
  **auto-hidden on non-active days** via `isGoalActiveOn`. Each bar *is* its own
  quick-add entry point.
- [ ] **Step 2:** `quick-add-sheet.tsx` — logs a **bare single-exercise session**
  (`source='quick'`). Scattered same-day entries stay **separate rows**; never
  merge them and never ask "which session." Exercise picker weighted toward
  most-used.
- [ ] **Step 3:** `body-module.tsx` — **one object, two lines, always rendered
  together.** Weight as a 7-day rolling average with the raw value never shown as
  the headline; waist with its own date. Enforce the pairing structurally: a
  single component that renders both, so no caller can render one alone.
- [ ] **Step 4:** Entry mechanisms differ **deliberately** (spec §6):
  - Weight → **passive affordance** on Home. No push, no badge, no notification.
  - Waist → **active nudge every ~14 days** from the last entry, quiet between.
- [ ] **Step 5:** `daily-checks.tsx` — exactly two checkboxes. **Not a
  ConsistencyGrid.** Reuse the `custom_habits` / `domain='fitness'` plumbing.
  Copy constraints are hard: gram number as a one-off caption only, never in a
  progress bar, never "X of Y g"; step checkbox must not imply a pedometer.
- [ ] **Step 6:** One static sentence that body fat is mostly a diet outcome,
  placed near the Body module. **One line. Never its own card, never recurring.**
- [ ] **Step 7:** Browser-verify every Home prop for the RSC function-prop rule.

**Acceptance:** rep bars appear only on active days; a quick-add from Home writes
a row and moves the bar; Body renders both lines or neither; no weight
notification exists anywhere in the code; 390px clean.

---

## Phase 6 — Seed plans and adoption (Engineer 3)

Spec §8. **Files:**
- Create: `lib/fitness/seed-plans.ts`, `lib/fitness/__tests__/seed-plans.test.ts`
- Create: `app/(app)/fitness/adopt-plan-action.ts`

- [ ] **Step 1:** Encode the starter plan (30 pull-ups + 100 push-ups, weekdays)
  as two `rep_goals` rows, and Plans A, B and C from spec §8.2 as workout
  templates with their exercises.
- [ ] **Step 2:** **Write a test that recomputes each plan's weekly volume with
  `weeklyVolume` and asserts it matches the per-muscle table in the spec.** If
  the numbers disagree, the spec is wrong and you tell me — do not silently
  adjust either side to match the other. This test is the reason the tables were
  written down.
- [ ] **Step 3:** Adoption action — picking a plan creates the user's exercises
  (deduping against existing by name), the workouts, and assigns them to
  weekdays. Idempotent: adopting twice must not create duplicates.
- [ ] **Step 4:** Exercises seeded by adoption carry correct primary/secondary
  muscle tags, since Phase 2's volume maths depends on them.

**Acceptance:** adopting a plan produces a schedule whose computed volume matches
the spec table exactly; adopting twice is a no-op.

---

## Phase 7 — Deletions and rewiring (Engineer 3)

**Files:**
- Delete: `components/fitness/today-workout-card.tsx`,
  `components/fitness/adhoc-workout-form.tsx`,
  `components/fitness/habit-list.tsx` *(only if no other domain imports it —
  check first)*
- Modify: `lib/home/get-domain-pulse.ts`, `lib/home/get-domain-snapshots.ts`
- Modify: `lib/checkins/prefill.ts`, `lib/checkins/get-allocation-queue.ts`
- Modify: `app/(app)/settings/export/route.ts`

- [ ] **Step 1:** `get-domain-pulse.ts` currently computes fitness from
  `habits.length + hasScheduledWorkout`. Repoint it at the new session model.
  Preserve the existing `safeFraction` semantics — **nothing tracked ≠ zero
  progress**; a null must stay null.
- [ ] **Step 2:** `prefill.ts` reads `workout_logs` as evidence and
  `workout_schedule` as placement. Repoint at `workout_sessions`. The
  evidence/placement split is deliberate and must survive: **suppression uses
  scheduled/prospective data, pre-fill uses logged/evidence data.** Do not
  collapse them.
- [ ] **Step 3:** Add `workout_sessions` / `session_sets` / `body_metrics` /
  `rep_goals` to the settings export route. An export that silently omits new
  tables is a data-loss bug.
- [ ] **Step 4:** Only once every reader is repointed and green, drop
  `workout_logs`. Migration `027`. If any reader remains, stop and say so.
- [ ] **Step 5:** Full suite green (currently 980 tests — the number must go up,
  not down), `tsc` clean, `eslint` clean, `next build` clean.

**Acceptance:** no import of a deleted component anywhere; export includes all
new tables; Home's fitness pulse is correct rather than merely non-crashing.

---

## Self-review notes

- **Spec coverage:** §2→P4, §2.1→P4 S3-4, §3→P4, §3.1→P5, §4→P3, §4.1→P3 S1,
  §5→P5 S1-2, §5.1/5.2→content only, no code, §6→P5 S3-4, §7→P5 S5-6, §8→P6,
  §9→P7. **Uncovered by design:** §5.1's ramp protocol and §5.2's joint-load
  guidance are *plan content* Ayman reads, not app behaviour — they belong in
  seed-plan copy, not in logic. §3.1's post-session notification is deferred; see
  open items.
- **Type consistency:** `MuscleGroup` is defined once in `volume.ts` and imported
  everywhere. `weeklyVolume` returns a full record so no caller branches on
  undefined.

## Open items carried from the spec

1. **Deload weeks** and **starter/session sequencing** are decisions for Ayman
   (spec §10). Neither blocks any phase; both affect seed-plan copy only.
2. **Post-session confirm notification** (spec §3.1) is deliberately NOT in this
   plan. Push has never successfully registered a device in production, and
   building a notification on unproven infrastructure would make this feature's
   success depend on an unrelated open bug. Ship the screen and Home surfaces
   first; revisit once push is proven.
3. **Plan B's core volume (6)** is the weakest number in the set and "visible
   abs" is the stated goal — worth revisiting after Phase 6's verification test
   confirms the arithmetic.
4. **Exercise selection wants a coach's review** before this becomes shipped copy
   (spec §8.4).
