import { describe, expect, it } from "vitest";
import { computeTodayCompletion, computeFocusTimeMinutes, allPrayersDoneDates } from "../home-kpis";

describe("computeTodayCompletion", () => {
  it("counts prayers on_time/qada as done out of a fixed total of 5", () => {
    const { done, total } = computeTodayCompletion({
      prayerStatuses: ["on_time", "qada", "pending", "pending", "missed"],
      killList: [],
      tasks: [],
      hasScheduledWorkout: false,
      workoutDone: false,
    });
    expect(done).toBe(2);
    expect(total).toBe(5);
  });

  it("adds kill list and task completion to the totals", () => {
    const { done, total } = computeTodayCompletion({
      prayerStatuses: ["pending", "pending", "pending", "pending", "pending"],
      killList: [{ completed: true }, { completed: false }],
      tasks: [{ completed: true }, { completed: true }, { completed: false }],
      hasScheduledWorkout: false,
      workoutDone: false,
    });
    expect(done).toBe(3); // 1 kill-list + 2 tasks
    expect(total).toBe(10); // 5 prayers + 2 kill-list + 3 tasks
  });

  it("only counts a workout in the total when one is actually scheduled today", () => {
    const withSchedule = computeTodayCompletion({
      prayerStatuses: [],
      killList: [],
      tasks: [],
      hasScheduledWorkout: true,
      workoutDone: true,
    });
    expect(withSchedule).toEqual({ done: 1, total: 1 });

    const withoutSchedule = computeTodayCompletion({
      prayerStatuses: [],
      killList: [],
      tasks: [],
      hasScheduledWorkout: false,
      workoutDone: false,
    });
    expect(withoutSchedule).toEqual({ done: 0, total: 0 });
  });
});

describe("computeFocusTimeMinutes", () => {
  it("sums completed session durations", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const minutes = computeFocusTimeMinutes(
      [
        { startedAt: new Date("2026-08-15T09:00:00Z"), endedAt: new Date("2026-08-15T09:30:00Z") },
        { startedAt: new Date("2026-08-15T10:00:00Z"), endedAt: new Date("2026-08-15T10:45:00Z") },
      ],
      now
    );
    expect(minutes).toBe(75);
  });

  it("treats an ongoing (unended) session as running until now", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const minutes = computeFocusTimeMinutes(
      [{ startedAt: new Date("2026-08-15T11:30:00Z"), endedAt: null }],
      now
    );
    expect(minutes).toBe(30);
  });

  it("returns 0 for no sessions", () => {
    expect(computeFocusTimeMinutes([], new Date())).toBe(0);
  });
});

describe("allPrayersDoneDates", () => {
  it("includes only dates where all 5 prayers are on_time or qada", () => {
    const dates = allPrayersDoneDates({
      "2026-08-14": ["on_time", "on_time", "qada", "on_time", "on_time"],
      "2026-08-15": ["on_time", "on_time", "missed", "on_time", "on_time"],
      "2026-08-13": ["on_time", "on_time", "on_time", "on_time", "on_time"],
    });
    expect(dates.sort()).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("excludes a date with fewer than 5 logged prayers", () => {
    const dates = allPrayersDoneDates({ "2026-08-15": ["on_time", "on_time"] });
    expect(dates).toEqual([]);
  });
});
