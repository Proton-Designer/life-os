import { describe, expect, it } from "vitest";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";

describe("calculateWeeklyConsistency", () => {
  it("doesn't count days before a habit's creation date as incomplete", () => {
    // Week is Sun 2026-08-09 .. Sat 2026-08-15. Habit created Tue 2026-08-11.
    // "Today" cutoff is Thu 2026-08-13, so only Tue/Wed/Thu are in scope for
    // this habit — all three are logged complete, so consistency should be 1.0,
    // not penalized for Sun/Mon (before creation) or Fri/Sat (future).
    const habits = [{ id: "h1", createdAt: "2026-08-11" }];
    const logs = [
      { habitId: "h1", date: "2026-08-11", completed: true },
      { habitId: "h1", date: "2026-08-12", completed: true },
      { habitId: "h1", date: "2026-08-13", completed: true },
    ];

    const consistency = calculateWeeklyConsistency(
      habits,
      logs,
      "2026-08-09",
      "2026-08-13"
    );

    expect(consistency).toBe(1);
  });

  it("counts a missed day within the habit's active range as incomplete", () => {
    const habits = [{ id: "h1", createdAt: "2026-08-09" }];
    const logs = [
      { habitId: "h1", date: "2026-08-09", completed: true },
      { habitId: "h1", date: "2026-08-10", completed: false },
    ];

    const consistency = calculateWeeklyConsistency(
      habits,
      logs,
      "2026-08-09",
      "2026-08-10"
    );

    expect(consistency).toBe(0.5);
  });

  it("returns 0 (not NaN) when there are no habits yet", () => {
    const consistency = calculateWeeklyConsistency([], [], "2026-08-09", "2026-08-10");
    expect(consistency).toBe(0);
  });

  it("averages across multiple habits with different creation dates", () => {
    const habits = [
      { id: "h1", createdAt: "2026-08-09" }, // 2 trackable days by cutoff
      { id: "h2", createdAt: "2026-08-10" }, // 1 trackable day by cutoff
    ];
    const logs = [
      { habitId: "h1", date: "2026-08-09", completed: true },
      { habitId: "h1", date: "2026-08-10", completed: true },
      { habitId: "h2", date: "2026-08-10", completed: false },
    ];

    const consistency = calculateWeeklyConsistency(
      habits,
      logs,
      "2026-08-09",
      "2026-08-10"
    );

    // 2 done out of 3 trackable habit-days total.
    expect(consistency).toBeCloseTo(2 / 3);
  });
});
