import { describe, expect, it } from "vitest";
import { getMostRecentCompletedWeek, getThisWeekSoFar } from "../week-range";

describe("getMostRecentCompletedWeek", () => {
  it("on a Sunday, returns exactly the week that just ended", () => {
    // 2026-09-13 is a Sunday.
    const range = getMostRecentCompletedWeek("2026-09-13");
    expect(range).toEqual({ startDate: "2026-09-06", endDateExclusive: "2026-09-13" });
  });

  it("mid-week, still returns the last FULLY completed week, not a partial one ending today", () => {
    // 2026-09-16 is a Wednesday; this week (Sun 09-13 - Sat 09-19) is not done yet.
    const range = getMostRecentCompletedWeek("2026-09-16");
    expect(range).toEqual({ startDate: "2026-09-06", endDateExclusive: "2026-09-13" });
  });

  it("on a Saturday (the last day of the current week), still excludes the in-progress week", () => {
    // 2026-09-19 is a Saturday, the last day of the week starting 09-13.
    const range = getMostRecentCompletedWeek("2026-09-19");
    expect(range).toEqual({ startDate: "2026-09-06", endDateExclusive: "2026-09-13" });
  });

  it("the returned range is exactly 7 days wide", () => {
    const range = getMostRecentCompletedWeek("2026-09-16");
    const days = (Date.parse(`${range.endDateExclusive}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(7);
  });
});

describe("getThisWeekSoFar", () => {
  it("starts at this week's Sunday and ends the day AFTER today (half-open, inclusive of today)", () => {
    const range = getThisWeekSoFar("2026-09-16"); // Wednesday
    expect(range).toEqual({ startDate: "2026-09-13", endDateExclusive: "2026-09-17" });
  });

  it("on a Sunday, is a single-day range covering just today", () => {
    const range = getThisWeekSoFar("2026-09-13");
    expect(range).toEqual({ startDate: "2026-09-13", endDateExclusive: "2026-09-14" });
  });
});
