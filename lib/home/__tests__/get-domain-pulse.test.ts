import { describe, expect, it, vi } from "vitest";
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

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // 2 done out of 5 trackables (5 prayers — adhkar dropped from the UI,
    // see the Home/Deen/Business overhaul).
    expect(pulse.deen).toBeCloseTo(2 / 5);
  });

  /**
   * R9 regression: `prayersDone` used to be a DENYLIST
   * (`status !== "pending" && status !== "missed"`), which silently counted
   * ANY future status value as done — including 'unlogged' (R9's own new
   * non-destructive "unlog" value), the opposite of what unlogging a
   * prayer should do to this fraction. Fixed to an allowlist
   * (`status === "on_time" || status === "qada"`), matching
   * lib/home/home-kpis.ts's already-correct pattern for the same table.
   */
  it("does NOT count an 'unlogged' prayer as done — R9's non-destructive unlog must not read as completion", async () => {
    const dataSource = emptyDataSource({
      getPrayers: async () => [
        { prayer_name: "fajr", status: "on_time" },
        { prayer_name: "dhuhr", status: "unlogged" },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // Only fajr counts — dhuhr's 'unlogged' must read the same as absent,
    // not as done. Before the fix this asserted 2/5 (the exact bug).
    expect(pulse.deen).toBeCloseTo(1 / 5);
  });

  it("returns null for a domain with zero trackables set today rather than dividing by zero", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", true, emptyDataSource());

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

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    expect(pulse.business).toBeCloseTo(2 / 3);
  });

  it("keeps Work and School as independent fractions (no pooling)", async () => {
    const dataSource = emptyDataSource({
      getSchoolTasks: async () => [{ completed: true }],
      getCurrentCoopTargetTaskCompletion: async () => [{ completed: false }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    expect(pulse.school).toBeCloseTo(1 / 1);
    expect(pulse.co_op).toBeCloseTo(0 / 1);
  });

  it("has a null School fraction when there are no school tasks today, even if Work has tasks", async () => {
    const dataSource = emptyDataSource({
      getCurrentCoopTargetTaskCompletion: async () => [{ completed: true }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    expect(pulse.school).toBeNull();
    expect(pulse.co_op).toBe(1);
  });

  it("has a null Work fraction with no current target, or a current target with zero tasks", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", true, emptyDataSource());

    expect(pulse.co_op).toBeNull();
  });

  it("counts the scheduled workout alongside habits for Fitness", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [{ workout_id: "workout-1" }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // 1 habit done + 1 workout done, out of 1 habit + 1 workout.
    expect(pulse.fitness).toBe(1);
  });

  it("counts an unlogged scheduled workout as not-done for Fitness", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // 1 habit done out of 1 habit + 1 workout.
    expect(pulse.fitness).toBeCloseTo(1 / 2);
  });

  it("has a null Fitness fraction on a rest day with no habits", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", true, emptyDataSource());

    expect(pulse.fitness).toBeNull();
  });

  it("does not count a workout_schedule row with a null workout_id as scheduled (legacy/unassigned row, new model)", async () => {
    const dataSource = emptyDataSource({
      getHabits: async () => [{ habitId: "h1", completed: true }],
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: null }),
      getWorkoutSessions: async () => [],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // 1 habit done out of 1 habit only — the unassigned day-slot doesn't
    // add a second trackable.
    expect(pulse.fitness).toBe(1);
  });

  it("matches a scheduled workout to a session by workout_id, not by which workout happens to be scheduled elsewhere", async () => {
    const dataSource = emptyDataSource({
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_id: "workout-1" }),
      getWorkoutSessions: async () => [{ workout_id: "workout-2" }],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", true, dataSource);

    // A session logged for a DIFFERENT workout than today's scheduled one
    // must not count as today's workout being done.
    expect(pulse.fitness).toBe(0);
  });
});

describe("getDomainPulse — Deen Mode OFF", () => {
  it("never reads prayers and reports deen: null (nothing tracked, not a fake 0); the other rings are untouched", async () => {
    const getPrayers = vi.fn(async () => [{ prayer_name: "fajr", status: "on_time" }]);
    const pulse = await getDomainPulse(
      "user-1",
      "2026-08-10",
      false,
      emptyDataSource({ getPrayers, getKillListItems: async () => [{ completed: true }] })
    );
    expect(getPrayers).not.toHaveBeenCalled();
    expect(pulse.deen).toBeNull();
    expect(pulse.business).toBe(1);
  });

  it("positive control: ON reads prayers", async () => {
    const getPrayers = vi.fn(async () => [{ prayer_name: "fajr", status: "on_time" }]);
    const pulse = await getDomainPulse("user-1", "2026-08-10", true, emptyDataSource({ getPrayers }));
    expect(getPrayers).toHaveBeenCalled();
    expect(pulse.deen).toBeCloseTo(1 / 5);
  });
});
