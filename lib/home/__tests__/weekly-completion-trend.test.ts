import { describe, expect, it } from "vitest";
import { computeWeeklyCompletionPct } from "../weekly-completion-trend";

describe("computeWeeklyCompletionPct", () => {
  it("computes a completion percent per day", () => {
    const pct = computeWeeklyCompletionPct([
      {
        prayerStatuses: ["on_time", "on_time", "on_time", "on_time", "on_time"],
        killList: [{ completed: true }],
        tasks: [],
        hasScheduledWorkout: false,
        workoutDone: false,
      },
      {
        prayerStatuses: ["pending", "pending", "pending", "pending", "pending"],
        killList: [],
        tasks: [],
        hasScheduledWorkout: false,
        workoutDone: false,
      },
    ]);
    expect(pct[0]).toBe(100);
    expect(pct[1]).toBe(0);
  });

  it("returns 0, not NaN, for a day with nothing due at all", () => {
    const pct = computeWeeklyCompletionPct([
      { prayerStatuses: [], killList: [], tasks: [], hasScheduledWorkout: false, workoutDone: false },
    ]);
    expect(pct[0]).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    const pct = computeWeeklyCompletionPct([
      {
        prayerStatuses: ["on_time", "on_time", "pending", "pending", "pending"],
        killList: [],
        tasks: [],
        hasScheduledWorkout: false,
        workoutDone: false,
      },
    ]);
    expect(pct[0]).toBe(40); // 2/5
  });
});
