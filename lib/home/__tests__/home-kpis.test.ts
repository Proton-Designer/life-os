import { describe, expect, it } from "vitest";
import { computeTodayCompletion } from "../home-kpis";

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
