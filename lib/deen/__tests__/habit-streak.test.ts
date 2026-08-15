import { describe, expect, it } from "vitest";
import { computeHabitStreak } from "../habit-streak";

describe("computeHabitStreak", () => {
  it("is 0 with no completed days", () => {
    expect(computeHabitStreak([], "2026-08-10")).toBe(0);
  });

  it("counts consecutive completed days walking back from today", () => {
    const dates = ["2026-08-08", "2026-08-09", "2026-08-10"];
    expect(computeHabitStreak(dates, "2026-08-10")).toBe(3);
  });

  it("still counts yesterday's streak if today isn't logged yet", () => {
    const dates = ["2026-08-08", "2026-08-09"];
    expect(computeHabitStreak(dates, "2026-08-10")).toBe(2);
  });

  it("hard-resets on a missed day (no freeze mechanic)", () => {
    const dates = ["2026-08-05", "2026-08-09", "2026-08-10"];
    expect(computeHabitStreak(dates, "2026-08-10")).toBe(2);
  });

  it("is 0 when the most recent completion is more than a day before today", () => {
    const dates = ["2026-08-05"];
    expect(computeHabitStreak(dates, "2026-08-10")).toBe(0);
  });

  it("de-duplicates repeated dates in the input", () => {
    const dates = ["2026-08-10", "2026-08-10", "2026-08-09"];
    expect(computeHabitStreak(dates, "2026-08-10")).toBe(2);
  });
});
