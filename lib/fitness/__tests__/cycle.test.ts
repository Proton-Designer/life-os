import { describe, expect, it } from "vitest";
import { CYCLE_LENGTH_DAYS, cycleForDate, isInBenchmarkWindow } from "../cycle";

describe("cycleForDate", () => {
  it("day 1 of cycle 1 is the anchor date itself", () => {
    const cycle = cycleForDate("2026-01-01", "2026-01-01");
    expect(cycle).toEqual({ cycleNumber: 1, startDate: "2026-01-01", endDate: "2026-01-28", daysLeft: 28 });
  });

  it("the last day of cycle 1 has daysLeft 1", () => {
    const cycle = cycleForDate("2026-01-01", "2026-01-28");
    expect(cycle).toEqual({ cycleNumber: 1, startDate: "2026-01-01", endDate: "2026-01-28", daysLeft: 1 });
  });

  it("the first day of cycle 2 rolls over correctly", () => {
    const cycle = cycleForDate("2026-01-01", "2026-01-29");
    expect(cycle).toEqual({ cycleNumber: 2, startDate: "2026-01-29", endDate: "2026-02-25", daysLeft: 28 });
  });

  it("CYCLE_LENGTH_DAYS is 28", () => {
    expect(CYCLE_LENGTH_DAYS).toBe(28);
  });

  it("is DST-safe: cycle boundaries land on the correct calendar date across a spring-forward transition", () => {
    // US DST 2026 spring-forward is 2026-03-08. Anchor well before it, walk
    // a date range straddling it — pure calendar-day arithmetic (Date.UTC
    // under the hood) never touches local wall-clock, so nothing should
    // drift by an hour/day near the transition.
    const cycle = cycleForDate("2026-02-20", "2026-03-10");
    // offset = Feb20->Mar10 = 18 days, cycleIndex 0.
    expect(cycle.cycleNumber).toBe(1);
    expect(cycle.startDate).toBe("2026-02-20");
    expect(cycle.endDate).toBe("2026-03-19");
    expect(cycle.daysLeft).toBe(10);
  });

  it("adversarial: a dateStr before the anchor clamps to cycle 1, day 1 rather than going negative", () => {
    const cycle = cycleForDate("2026-06-01", "2026-01-01");
    expect(cycle.cycleNumber).toBe(1);
    expect(cycle.startDate).toBe("2026-06-01");
    expect(cycle.daysLeft).toBe(28);
  });

  it("adversarial: malformed date strings never throw", () => {
    expect(() => cycleForDate("not-a-date", "also-not-a-date")).not.toThrow();
    expect(() => cycleForDate("", "")).not.toThrow();
    const cycle = cycleForDate("not-a-date", "also-not-a-date");
    expect(cycle.cycleNumber).toBe(1);
  });
});

describe("isInBenchmarkWindow", () => {
  it("true only in the last 3 days (default window) of the cycle, inclusive", () => {
    expect(isInBenchmarkWindow({ cycleNumber: 1, startDate: "a", endDate: "b", daysLeft: 4 })).toBe(false);
    expect(isInBenchmarkWindow({ cycleNumber: 1, startDate: "a", endDate: "b", daysLeft: 3 })).toBe(true);
    expect(isInBenchmarkWindow({ cycleNumber: 1, startDate: "a", endDate: "b", daysLeft: 1 })).toBe(true);
    expect(isInBenchmarkWindow({ cycleNumber: 1, startDate: "a", endDate: "b", daysLeft: 0 })).toBe(false);
  });

  it("respects a custom window size", () => {
    expect(isInBenchmarkWindow({ cycleNumber: 1, startDate: "a", endDate: "b", daysLeft: 5 }, 7)).toBe(true);
  });
});
