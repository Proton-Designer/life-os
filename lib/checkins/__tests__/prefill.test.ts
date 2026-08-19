import { describe, expect, it } from "vitest";
import { derivePrefillAllocation } from "../prefill";
import type { AllocationWindow, TimeRange } from "../schedule";

const window: AllocationWindow = {
  start: new Date("2026-08-10T13:00:00Z"), // 08:00 CDT
  end: new Date("2026-08-10T15:00:00Z"), // 10:00 CDT
};

describe("derivePrefillAllocation", () => {
  it("returns all zeros when there's no data to derive from", () => {
    const result = derivePrefillAllocation(window, { lockInSessions: [], prayerWindows: [], workoutTime: null });
    expect(result).toEqual({ deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 });
  });

  it("maps a fully-contained Lock-In session to business, snapped to 15", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:07:00Z"), end: new Date("2026-08-10T13:52:00Z") }; // 45 real minutes
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.business).toBe(45); // already a multiple of 15
  });

  it("clips a Lock-In session that only partially overlaps the window", () => {
    const session: TimeRange = { start: new Date("2026-08-10T14:30:00Z"), end: new Date("2026-08-10T15:45:00Z") }; // starts in-window, ends after
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.business).toBe(30); // only 14:30-15:00 (30min) is inside the window
  });

  it("counts a still-active (open-ended) Lock-In session up to the window's own end", () => {
    const session: TimeRange = { start: new Date("2026-08-10T14:00:00Z"), end: null };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.business).toBe(60); // 14:00-15:00
  });

  it("snaps an overlap down to the nearest 15, never rounding up", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T13:22:00Z") }; // 22 real minutes
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.business).toBe(15);
  });

  it("maps a prayer window overlap to deen", () => {
    const prayer: TimeRange = { start: new Date("2026-08-10T13:15:00Z"), end: new Date("2026-08-10T13:30:00Z") };
    const result = derivePrefillAllocation(window, { lockInSessions: [], prayerWindows: [prayer], workoutTime: null });
    expect(result.deen).toBe(15);
  });

  it("sums multiple prayer windows falling inside the same allocation window", () => {
    const fajr: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T13:15:00Z") };
    const dhuhr: TimeRange = { start: new Date("2026-08-10T14:00:00Z"), end: new Date("2026-08-10T14:15:00Z") };
    const result = derivePrefillAllocation(window, { lockInSessions: [], prayerWindows: [fajr, dhuhr], workoutTime: null });
    expect(result.deen).toBe(30);
  });

  it("adds a nominal fitness block when a scheduled workout's time falls inside the window", () => {
    const result = derivePrefillAllocation(window, {
      lockInSessions: [],
      prayerWindows: [],
      workoutTime: new Date("2026-08-10T14:00:00Z"),
    });
    expect(result.fitness).toBe(30);
  });

  it("does not add a fitness block for a workout time outside the window", () => {
    const result = derivePrefillAllocation(window, {
      lockInSessions: [],
      prayerWindows: [],
      workoutTime: new Date("2026-08-10T16:00:00Z"),
    });
    expect(result.fitness).toBe(0);
  });

  it("never guesses school or co_op — always 0, since nothing logs data for them here", () => {
    const session: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.school).toBe(0);
    expect(result.co_op).toBe(0);
  });

  it("caps the total below the window's own length when sources overlap and would otherwise overrun it", () => {
    // Both a Lock-In session and a prayer window covering the entire 2h window.
    const session: TimeRange = { start: window.start, end: window.end };
    const prayer: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, {
      lockInSessions: [session],
      prayerWindows: [prayer],
      workoutTime: new Date("2026-08-10T14:00:00Z"),
    });
    const total = result.deen + result.business + result.school + result.fitness + result.co_op;
    expect(total).toBeLessThan(120);
    expect(total % 15).toBe(0);
  });

  it("never rubber-stamps the window at 100% — a Lock-In session spanning the entire window alone still leaves at least one STEP wasted", () => {
    // Per the Lead's ruling (2026-08-19): pre-fill must never complete the
    // window, even when the real data genuinely covers all of it, so
    // correcting the pre-fill — not just tapping Done — stays the rewarded
    // action.
    const fullWindowSession: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, {
      lockInSessions: [fullWindowSession],
      prayerWindows: [],
      workoutTime: null,
    });
    const total = result.deen + result.business + result.school + result.fitness + result.co_op;
    expect(total).toBe(105); // 120 - one STEP reserved as wasted
    expect(result.business).toBe(105);
  });

  it("leaves a within-bounds allocation untouched by the cap", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T13:30:00Z") };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], prayerWindows: [], workoutTime: null });
    expect(result.business).toBe(30);
  });
});
