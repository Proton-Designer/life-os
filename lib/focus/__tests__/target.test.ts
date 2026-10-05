import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS_TARGET_MINUTES,
  focusTargetMinutes,
  formatTargetHours,
  isWeekendLocalDate,
  validateFocusTargets,
} from "../target";

// 2026-10-02 Fri, 10-03 Sat, 10-04 Sun, 10-05 Mon
describe("focusTargetMinutes", () => {
  it("no settings / nothing set = the 240 default", () => {
    expect(focusTargetMinutes(null, "2026-10-05")).toBe(DEFAULT_FOCUS_TARGET_MINUTES);
    expect(focusTargetMinutes({ dailyMinutes: null, weekendMinutes: null }, "2026-10-05")).toBe(240);
  });
  it("uses the daily target on weekdays", () => {
    expect(focusTargetMinutes({ dailyMinutes: 300, weekendMinutes: 120 }, "2026-10-02")).toBe(300);
    expect(focusTargetMinutes({ dailyMinutes: 300, weekendMinutes: 120 }, "2026-10-05")).toBe(300);
  });
  it("uses the weekend target on Saturday AND Sunday (local dates)", () => {
    expect(focusTargetMinutes({ dailyMinutes: 300, weekendMinutes: 120 }, "2026-10-03")).toBe(120);
    expect(focusTargetMinutes({ dailyMinutes: 300, weekendMinutes: 120 }, "2026-10-04")).toBe(120);
  });
  it("weekend falls back to the daily target when no weekend target is set, and to the default when neither is", () => {
    expect(focusTargetMinutes({ dailyMinutes: 300, weekendMinutes: null }, "2026-10-03")).toBe(300);
    expect(focusTargetMinutes({ dailyMinutes: null, weekendMinutes: null }, "2026-10-04")).toBe(240);
    expect(focusTargetMinutes({ dailyMinutes: null, weekendMinutes: 90 }, "2026-10-04")).toBe(90);
  });
  it("an out-of-range stored value is ignored, never trusted (the DB CHECK is 30-720)", () => {
    expect(focusTargetMinutes({ dailyMinutes: 5, weekendMinutes: 9999 }, "2026-10-03")).toBe(240);
  });
  it("positive control: the weekend rule really differs from the weekday rule for the same settings", () => {
    const s = { dailyMinutes: 300, weekendMinutes: 120 };
    expect(focusTargetMinutes(s, "2026-10-03")).not.toBe(focusTargetMinutes(s, "2026-10-05"));
  });
});

describe("isWeekendLocalDate", () => {
  it("Sat/Sun only", () => {
    expect(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map(isWeekendLocalDate)).toEqual([false, true, true, false]);
  });
});

describe("validateFocusTargets", () => {
  it("accepts null, the bounds, and in-range whole minutes", () => {
    expect(validateFocusTargets({ dailyMinutes: null, weekendMinutes: null })).toBeNull();
    expect(validateFocusTargets({ dailyMinutes: 30, weekendMinutes: 720 })).toBeNull();
  });
  it("rejects below 30, above 720, and non-integers, naming which target", () => {
    expect(validateFocusTargets({ dailyMinutes: 29, weekendMinutes: null })).toMatch(/Daily/);
    expect(validateFocusTargets({ dailyMinutes: null, weekendMinutes: 721 })).toMatch(/Weekend/);
    expect(validateFocusTargets({ dailyMinutes: 90.5, weekendMinutes: null })).toMatch(/whole number/);
  });
});

describe("formatTargetHours", () => {
  it("renders hours without trailing zeros", () => {
    expect([240, 270, 150, 195, 30].map(formatTargetHours)).toEqual(["4", "4.5", "2.5", "3.25", "0.5"]);
  });
});
