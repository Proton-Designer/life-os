import { describe, expect, it } from "vitest";
import { weeklyVolume, MUSCLE_GROUPS, type SetEntry } from "../volume";
import { SEED_PLANS, STARTER_REP_GOALS, type SeedPlan } from "../seed-plans";

/**
 * The enforcement mechanism referenced in seed-plans.ts's doc comment: this
 * is what makes the tags the source of truth. A future edit that changes a
 * tag without updating the expected tables below (or vice versa) fails
 * here — fix the SPEC's tables (and these expectations) to match freshly
 * computed output, never retune a tag just to turn this test green again.
 */

function planWeeklySetEntries(plan: SeedPlan): SetEntry[] {
  const entries: SetEntry[] = [];
  for (const workoutName of plan.weekdayWorkoutNames) {
    const workout = plan.workouts.find((w) => w.name === workoutName);
    if (!workout) throw new Error(`seed-plans.ts: "${workoutName}" is scheduled but not defined as a workout`);
    for (const we of workout.exercises) {
      entries.push({
        sets: we.targetSets,
        primaryMuscles: we.exercise.primaryMuscles,
        secondaryMuscles: we.exercise.secondaryMuscles,
      });
    }
  }
  return entries;
}

// docs/superpowers/specs/2026-08-19-fitness-redesign.md §8.2, as
// regenerated 2026-08-20 from this file's tags via weeklyVolume — not
// hand-verified against them. See seed-plans.ts's doc comment for why the
// direction of truth runs this way now.
const EXPECTED = {
  plan_a: {
    chest: 15, back_lats: 9, back_mid: 10.5, front_delt: 7.5, side_delt: 15,
    rear_delt: 18, biceps: 13.5, triceps: 16.5, core: 15,
  },
  plan_b: {
    chest: 13.5, back_lats: 12, back_mid: 13.5, front_delt: 15, side_delt: 13.5,
    rear_delt: 15, biceps: 15, triceps: 18, core: 12,
  },
  plan_c: {
    chest: 12, back_lats: 6, back_mid: 13.5, front_delt: 9, side_delt: 16.5,
    rear_delt: 19.5, biceps: 13.5, triceps: 13.5, core: 18,
  },
} as const;

describe("each seed plan's computed weekly volume matches spec §8.2 exactly", () => {
  for (const plan of SEED_PLANS) {
    it(`${plan.key} (${plan.name})`, () => {
      const result = weeklyVolume(planWeeklySetEntries(plan));
      expect(result).toEqual(EXPECTED[plan.key]);
    });
  }
});

describe("no seed plan's bucket exceeds the evidence-backed 20 sets/muscle/week ceiling", () => {
  // This is the one universal constraint the Lead actually set (2026-08-20
  // trim pass) — over-dosing risk when stacked against the starter plan's
  // 500 weekly push-ups/150 pull-ups. There is deliberately NO
  // corresponding blanket floor test: Plan A's back_lats sits at 9 and
  // every plan's front_delt sits well under 12 by design (front_delt is a
  // synergist-only bucket, spec §8.2 — its isolated number always
  // undercounts true stimulus), and Plan C's back_lats 6 is the
  // under-train-what-the-starter-over-supplies principle working as
  // intended. Only two specific floors were ever required — Plan B's core
  // >=12 and back_mid >=12 — and both are covered by the exact-match test
  // above, not by a made-up universal rule here.
  for (const plan of SEED_PLANS) {
    it(`${plan.key} has no bucket over 20`, () => {
      const result = weeklyVolume(planWeeklySetEntries(plan));
      for (const m of MUSCLE_GROUPS) {
        expect(result[m]).toBeLessThanOrEqual(20);
      }
    });
  }
});

describe("every seed workout's weekday assignment points at a workout that actually exists", () => {
  for (const plan of SEED_PLANS) {
    it(`${plan.key}`, () => {
      expect(() => planWeeklySetEntries(plan)).not.toThrow();
    });
  }
});

describe("the starter plan's rep goals", () => {
  it("is exactly two goals: 30 pull-ups and 100 push-ups", () => {
    expect(STARTER_REP_GOALS).toHaveLength(2);
    const pullUps = STARTER_REP_GOALS.find((g) => g.exercise.name === "Pull-ups");
    const pushUps = STARTER_REP_GOALS.find((g) => g.exercise.name === "Push-ups");
    expect(pullUps?.dailyTarget).toBe(30);
    expect(pushUps?.dailyTarget).toBe(100);
  });

  it("is active on weekdays only (Mon-Fri, per Ayman's ruling)", () => {
    for (const goal of STARTER_REP_GOALS) {
      expect(goal.activeDays).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("reuses the same 'Pull-ups' exercise the seed plans use, rather than creating a duplicate", () => {
    const starterPullUpsTags = STARTER_REP_GOALS.find((g) => g.exercise.name === "Pull-ups")!.exercise;
    const planAPullUpsEntry = SEED_PLANS[0].workouts
      .flatMap((w) => w.exercises)
      .find((we) => we.exercise.name === "Pull-ups")!.exercise;
    expect(starterPullUpsTags).toEqual(planAPullUpsEntry);
  });
});
