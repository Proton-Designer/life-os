/**
 * Seed content — the starter plan (§5) and the three ready-made session
 * plans (§8.2) from docs/superpowers/specs/2026-08-19-fitness-redesign.md.
 * docs/superpowers/plans/2026-08-20-fitness-redesign.md Phase 6.
 *
 * SOURCE OF TRUTH, read before touching either this file or the spec:
 * the exercise tags below (`primaryMuscles`/`secondaryMuscles`) ARE the
 * source of truth for every weekly-volume number in spec §8.2. The tables
 * in the spec are DERIVED from this file by running `weeklyVolume` over
 * it, and that derivation is enforced by
 * lib/fitness/__tests__/seed-plans.test.ts. If a future edit to this file
 * makes that test disagree with the spec's tables, the fix is to
 * regenerate the spec's tables from the new computed output — never to
 * adjust a tag just to make the test pass again. The test failing IS the
 * signal that the spec needs a rewrite, not a bug to silence.
 *
 * This exact drift already happened once (2026-08-20): §8.2's original
 * tables were hand arithmetic from the brainstorm rounds, computed across
 * several hours before `weeklyVolume` existed as a tested function, with
 * inconsistent secondary-muscle crediting between exercises (some presses
 * credited two secondaries, some one). When the formalized function was
 * run against anatomically-tagged versions of the same exercises, none of
 * the three plans matched the hand-computed tables — Plan C's total came
 * out nearly identical (118.5 vs 117) but redistributed across muscles,
 * while Plan A/B's totals diverged outright (120 vs 102.5, similarly for
 * B), which is what pinned the cause on inconsistent hand-tagging rather
 * than a flaw in the formula. The tables were regenerated from this file's
 * tags and the spec was rewritten to match, with two more real fixes along
 * the way: `overhead_press` was originally mistagged side-delt-primary
 * (anatomically it's anterior-deltoid/front-delt dominant), and Plans B/C
 * both had at least one muscle bucket computing over the evidence-backed
 * 12–20 sets/muscle/week optimum, which is a genuine over-dosing risk for
 * an untrained trainee stacking these against the starter plan's 500
 * weekly push-ups/150 pull-ups — not a table typo to shrug off.
 */

import type { MuscleGroup } from "./volume";

export type SeedExercise = {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
};

export type SeedWorkoutExercise = {
  exercise: SeedExercise;
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
};

export type SeedWorkout = {
  name: string;
  exercises: SeedWorkoutExercise[];
};

export type SeedPlan = {
  key: "plan_a" | "plan_b" | "plan_c";
  name: string;
  /** Mon-Fri, index 0 = Monday, each pointing at one of `workouts` by name. */
  weekdayWorkoutNames: [string, string, string, string, string];
  workouts: SeedWorkout[];
};

// --- Exercise library -------------------------------------------------
// Cable machine + pull-up bar only (spec §8: no barbell, no bench, no free
// weights). Every exercise here is something the described equipment can
// actually perform.

const chestPress: SeedExercise = { name: "Cable chest press", primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "front_delt"] };
const inclinePress: SeedExercise = { name: "Incline-angle cable press", primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "front_delt"] };
const cableFly: SeedExercise = { name: "Cable fly", primaryMuscles: ["chest"], secondaryMuscles: [] };
const pullUps: SeedExercise = { name: "Pull-ups", primaryMuscles: ["back_lats"], secondaryMuscles: ["biceps"] };
const seatedRow: SeedExercise = { name: "Seated cable row", primaryMuscles: ["back_mid"], secondaryMuscles: ["biceps", "rear_delt"] };
const chestSupportedRow: SeedExercise = { name: "Chest-supported cable row", primaryMuscles: ["back_mid"], secondaryMuscles: ["biceps"] };
const widePulldown: SeedExercise = { name: "Wide-grip lat pulldown", primaryMuscles: ["back_lats"], secondaryMuscles: ["biceps"] };
const straightArmPulldown: SeedExercise = { name: "Straight-arm pulldown", primaryMuscles: ["back_lats"], secondaryMuscles: [] };
const lateralRaise: SeedExercise = { name: "Cable lateral raise", primaryMuscles: ["side_delt"], secondaryMuscles: [] };
const facePull: SeedExercise = { name: "Face pull", primaryMuscles: ["rear_delt"], secondaryMuscles: ["back_mid"] };
const rearDeltFly: SeedExercise = { name: "Rear-delt fly", primaryMuscles: ["rear_delt"], secondaryMuscles: [] };
// Overhead pressing is anterior-deltoid dominant, not lateral-deltoid —
// mistagged side_delt-primary in the first pass of this file, caught and
// fixed 2026-08-20 (see the doc comment above).
const overheadPress: SeedExercise = { name: "Cable overhead press", primaryMuscles: ["front_delt"], secondaryMuscles: ["side_delt", "triceps"] };
const pushdown: SeedExercise = { name: "Triceps pushdown", primaryMuscles: ["triceps"], secondaryMuscles: [] };
const dips: SeedExercise = { name: "Dips", primaryMuscles: ["triceps"], secondaryMuscles: ["chest", "front_delt"] };
const curl: SeedExercise = { name: "Cable curl", primaryMuscles: ["biceps"], secondaryMuscles: [] };
const kneeRaise: SeedExercise = { name: "Hanging knee raise", primaryMuscles: ["core"], secondaryMuscles: [] };
const crunch: SeedExercise = { name: "Cable crunch", primaryMuscles: ["core"], secondaryMuscles: [] };
const woodchop: SeedExercise = { name: "Cable woodchop", primaryMuscles: ["core"], secondaryMuscles: [] };

function we(exercise: SeedExercise, targetSets: number, targetRepsLow: number, targetRepsHigh: number): SeedWorkoutExercise {
  return { exercise, targetSets, targetRepsLow, targetRepsHigh };
}

// --- Plan A: Rotating Upper (uniform frequency, low per-session dose) --
// Session A x3/week, Session B x2/week — spec §8.2.
// Computed weekly (unchanged from the first trim pass — every bucket was
// already inside the 12-20 band): chest 15, back_lats 9, back_mid 10.5,
// front_delt 7.5, side_delt 15, rear_delt 18, biceps 13.5, triceps 16.5,
// core 15.

const planASessionA: SeedWorkout = {
  name: "Plan A — Session A",
  exercises: [
    we(chestPress, 3, 6, 10),
    we(pullUps, 3, 5, 10),
    we(lateralRaise, 3, 12, 15),
    we(facePull, 3, 12, 15),
    we(pushdown, 3, 10, 15),
    we(kneeRaise, 3, 10, 15),
  ],
};

const planASessionB: SeedWorkout = {
  name: "Plan A — Session B",
  exercises: [
    we(inclinePress, 3, 8, 12),
    we(seatedRow, 3, 8, 12),
    we(lateralRaise, 3, 12, 15),
    we(rearDeltFly, 3, 12, 15),
    we(curl, 3, 10, 15),
    we(crunch, 3, 12, 15),
  ],
};

const planA: SeedPlan = {
  key: "plan_a",
  name: "Rotating Upper",
  weekdayWorkoutNames: [planASessionA.name, planASessionB.name, planASessionA.name, planASessionB.name, planASessionA.name],
  workouts: [planASessionA, planASessionB],
};

// --- Plan B: Push / Pull / Delts+Core / Push / Pull (segmented) -------
// Two trim passes on top of the first draft (spec revision, 2026-08-20):
// (1) Thu push swapped dips->cable fly and Fri pull swapped hammer
//     curl->straight-arm pulldown, to bring triceps/biceps under 20;
// (2) Tue pull swapped hammer curl->crunch and Thu push swapped incline
//     press->hanging knee raise, to bring core up to the 12 floor
//     (Ayman's stated goal is visible abs — a standalone plan can't ship
//     with the weakest number on the thing he actually asked for);
// (3) Tue pull swapped wide-grip pulldown (vertical pull, back_lats) for
//     a second horizontal row (back_mid), because 150 weekly pull-ups
//     under the starter plan is already enormous vertical-pull volume
//     with zero horizontal pulling — back_mid was the program's real gap,
//     not an arbitrary number under a floor.
// Computed weekly, final: chest 13.5, back_lats 12, back_mid 13.5,
// front_delt 15, side_delt 13.5, rear_delt 15, biceps 15, triceps 18,
// core 12. Every bucket inside 12-20.

const planBMonPush: SeedWorkout = {
  name: "Plan B — Push",
  exercises: [
    we(chestPress, 3, 6, 10),
    we(inclinePress, 3, 8, 12),
    we(dips, 3, 8, 12),
    we(pushdown, 3, 10, 15),
    we(lateralRaise, 3, 12, 15),
    we(overheadPress, 3, 8, 12),
  ],
};

const planBTuePull: SeedWorkout = {
  name: "Plan B — Pull",
  exercises: [
    we(pullUps, 3, 5, 10),
    we(chestSupportedRow, 3, 8, 12),
    we(seatedRow, 3, 8, 12),
    we(facePull, 3, 12, 15),
    we(curl, 3, 10, 15),
    we(crunch, 3, 12, 15),
  ],
};

const planBWedDeltsCore: SeedWorkout = {
  name: "Plan B — Delts + Core",
  exercises: [
    we(lateralRaise, 3, 12, 15),
    we(rearDeltFly, 3, 12, 15),
    we(overheadPress, 3, 8, 12),
    we(facePull, 3, 12, 15),
    we(kneeRaise, 3, 10, 15),
    we(crunch, 3, 12, 15),
  ],
};

const planBThuPush: SeedWorkout = {
  name: "Plan B — Push (varied)",
  exercises: [
    we(chestPress, 3, 6, 10),
    we(cableFly, 3, 12, 15),
    we(pushdown, 3, 10, 15),
    we(lateralRaise, 3, 12, 15),
    we(overheadPress, 3, 8, 12),
    we(kneeRaise, 3, 10, 15),
  ],
};

const planBFriPull: SeedWorkout = {
  name: "Plan B — Pull (varied)",
  exercises: [
    we(pullUps, 3, 5, 10),
    we(widePulldown, 3, 8, 12),
    we(seatedRow, 3, 8, 12),
    we(facePull, 3, 12, 15),
    we(curl, 3, 10, 15),
    we(straightArmPulldown, 3, 10, 15),
  ],
};

const planB: SeedPlan = {
  key: "plan_b",
  name: "Push / Pull / Delts+Core",
  weekdayWorkoutNames: [
    planBMonPush.name,
    planBTuePull.name,
    planBWedDeltsCore.name,
    planBThuPush.name,
    planBFriPull.name,
  ],
  workouts: [planBMonPush, planBTuePull, planBWedDeltsCore, planBThuPush, planBFriPull],
};

// --- Plan C: V-Taper Priority (asymmetric frequency, weak point favoured) -
// A delt pair and a core movement in every session; chest/lat volume held
// deliberately low since the starter plan already over-supplies them.
// One trim pass (spec revision, 2026-08-20): day 5's rear-delt fly (paired
// with face pull, both rear_delt — a same-session double dose) was
// replaced. The first replacement (a second curl) was wrong and caught
// before shipping — Plan C's whole principle is under-training what the
// starter plan over-supplies, and 150 weekly pull-ups is already a
// massive biceps load, so dumping the freed volume into biceps defeated
// the plan's own purpose. The second replacement attempt (a third core
// movement in one session — day 5 already had two) pushed core to 21,
// over the ceiling. Landed on `overheadPress`, which fixes the rear-delt
// overshoot without touching biceps or adding a third core slot to one
// session.
// Computed weekly, final: chest 12, back_lats 6, back_mid 13.5,
// front_delt 9, side_delt 16.5, rear_delt 19.5, biceps 13.5, triceps
// 13.5, core 18. back_lats 6 stays deliberately low — the same
// under-train-what-the-starter-over-supplies principle, not a defect.

const planCDay1: SeedWorkout = {
  name: "Plan C — Day 1",
  exercises: [
    we(chestPress, 3, 6, 10),
    we(seatedRow, 3, 8, 12),
    we(lateralRaise, 3, 12, 15),
    we(facePull, 3, 12, 15),
    we(crunch, 3, 12, 15),
    we(pushdown, 3, 10, 15),
  ],
};

const planCDay2: SeedWorkout = {
  name: "Plan C — Day 2",
  exercises: [
    we(pullUps, 3, 5, 10),
    we(inclinePress, 3, 8, 12),
    we(lateralRaise, 3, 12, 15),
    we(rearDeltFly, 3, 12, 15),
    we(kneeRaise, 3, 10, 15),
    we(curl, 3, 10, 15),
  ],
};

const planCDay3: SeedWorkout = {
  name: "Plan C — Day 3",
  exercises: [
    we(seatedRow, 3, 8, 12),
    we(chestPress, 3, 6, 10),
    we(lateralRaise, 3, 12, 15),
    we(facePull, 3, 12, 15),
    we(woodchop, 3, 12, 15),
    we(pushdown, 3, 10, 15),
  ],
};

const planCDay4: SeedWorkout = {
  name: "Plan C — Day 4",
  exercises: [
    we(pullUps, 3, 5, 10),
    we(inclinePress, 3, 8, 12),
    we(lateralRaise, 3, 12, 15),
    we(rearDeltFly, 3, 12, 15),
    we(kneeRaise, 3, 10, 15),
    we(curl, 3, 10, 15),
  ],
};

const planCDay5: SeedWorkout = {
  name: "Plan C — Day 5",
  exercises: [
    we(seatedRow, 3, 8, 12),
    we(lateralRaise, 3, 12, 15),
    we(facePull, 3, 12, 15),
    we(overheadPress, 3, 8, 12),
    we(crunch, 3, 12, 15),
    we(kneeRaise, 3, 10, 15),
  ],
};

const planC: SeedPlan = {
  key: "plan_c",
  name: "V-Taper Priority",
  weekdayWorkoutNames: [planCDay1.name, planCDay2.name, planCDay3.name, planCDay4.name, planCDay5.name],
  workouts: [planCDay1, planCDay2, planCDay3, planCDay4, planCDay5],
};

export const SEED_PLANS: SeedPlan[] = [planA, planB, planC];

// --- Starter plan: two rep_goals rows, not a session plan (spec §5) ----
// "For the starting workout plan just include 30 pull ups and 100 pushups
// everyday for 5 days (on the weekdays)." — orthogonal to the day-picker;
// no workout template involved. Both exercises still need to exist in the
// user's exercise library so quick-add logging can reference them and
// weekly-volume readers can roll them up like anything else, but they are
// not tagged into any workout's exercise list.

// Reuses `pullUps` (same name/tags as every plan's pull-up entry — the
// adoption action dedupes exercises by name, so this deliberately does not
// create a second "Pull-ups" row) and defines "Push-ups" fresh, since no
// plan above uses it (the seed plans are cable-machine-forward; push-ups
// only ever show up via the starter plan and quick-add).
const starterPushUps: SeedExercise = { name: "Push-ups", primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "front_delt"] };

export type SeedRepGoal = {
  exercise: SeedExercise;
  dailyTarget: number;
  /** 0=Sun … 6=Sat. Weekdays only, per Ayman's ruling. */
  activeDays: number[];
};

export const STARTER_REP_GOALS: SeedRepGoal[] = [
  { exercise: pullUps, dailyTarget: 30, activeDays: [1, 2, 3, 4, 5] },
  { exercise: starterPushUps, dailyTarget: 100, activeDays: [1, 2, 3, 4, 5] },
];
