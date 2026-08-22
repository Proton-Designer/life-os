import { describe, expect, it } from "vitest";
import { getDomainPulse, type PulseDataSource } from "../get-domain-pulse";

function emptyDataSource(overrides: Partial<PulseDataSource> = {}): PulseDataSource {
  return {
    getPrayers: async () => [],
    getKillListItems: async () => [],
    getSchoolTasks: async () => [],
    getCurrentCoopTargetTaskCompletion: async () => [],
    getHabits: async () => [],
    getWorkoutSchedule: async () => null,
    getWorkoutSessions: async () => [],
    ...overrides,
  };
}

describe("getDomainPulse", () => {
  it("computes Deen's fraction from prayers only (5 trackables/day)", async () => {
    const dataSource = emptyDataSource({
      getPrayers: async () => [
        { prayer_name: "fajr", status: "on_time" },
        { prayer_name: "dhuhr", status: "on_time" },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // 2 done out of 5 trackables (5 prayers — adhkar dropped from the UI,
    // see the Home/Deen/Business overhaul).
    expect(pulse.deen).toBeCloseTo(2 / 5);
  });

  it("returns null for a domain with zero trackables set today rather than dividing by zero", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", emptyDataSource());

    expect(pulse.business).toBeNull();
  });

  it("computes Business's fraction from kill list completion", async () => {
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { completed: true },
        { completed: true },
        { completed: false },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    expect(pulse.business).toBeCloseTo(2 / 3);
  });

  it("keeps Work and School as independent fractions (no pooling)", async () => {
    const dataSource = emptyDataSource({
      getSchoolTasks: async () => [{ completed: true }],
      getCurrentCoopTargetTaskCompletion: async () => [{ completed: false }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    expect(pulse.school).toBeCloseTo(1 / 1);
    expect(pulse.co_op).toBeCloseTo(0 / 1);
  });

  it("has a null School fraction when there are no school tasks today, even if Work has tasks", async () => {
    const dataSource = emptyDataSource({
      getCurrentCoopTargetTaskCompletion: async () => [{ completed: true }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    expect(pulse.school).toBeNull();
    expect(pulse.co_op).toBe(1);
  });

  it("has a null Work fraction with no current target, or a current target with zero tasks", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", emptyDataSource());

    expect(pulse.co_op).toBeNull();
  });

  it("counts the scheduled workout alongside habits for Fitness", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [{ workout_id: "workout-1" }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // 1 habit done + 1 workout done, out of 1 habit + 1 workout.
    expect(pulse.fitness).toBe(1);
  });

  it("counts an unlogged scheduled workout as not-done for Fitness", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // 1 habit done out of 1 habit + 1 workout.
    expect(pulse.fitness).toBeCloseTo(1 / 2);
  });

  it("has a null Fitness fraction on a rest day with no habits", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", emptyDataSource());

    expect(pulse.fitness).toBeNull();
  });

  it("does not count a workout_schedule row with a null workout_id as scheduled (legacy/unassigned row, new model)", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: null }),
      getWorkoutSessions: async () => [],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // 1 habit done out of 1 habit only — the unassigned day-slot doesn't
    // add a second trackable.
    expect(pulse.fitness).toBe(1);
  });

  it("matches a scheduled workout to a session by workout_id, not by which workout happens to be scheduled elsewhere", async () => {
    const dataSource = emptyDataSource({
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [{ workout_id: "workout-2" }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // A session logged for a DIFFERENT workout than today's scheduled one
    // must not count as today's workout being done.
    expect(pulse.fitness).toBe(0);
  });
});
