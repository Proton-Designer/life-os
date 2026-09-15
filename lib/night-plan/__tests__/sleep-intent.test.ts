import { describe, expect, it } from "vitest";
import { isValidBedtime, setSleepIntent, clearSleepIntent, type SleepIntentState } from "../sleep-intent";

describe("isValidBedtime()", () => {
  it("accepts valid 24h HH:MM times, including midnight and the last minute of the day", () => {
    expect(isValidBedtime("00:00")).toBe(true);
    expect(isValidBedtime("23:59")).toBe(true);
    expect(isValidBedtime("21:30")).toBe(true);
    expect(isValidBedtime("09:05")).toBe(true);
  });

  it("rejects an out-of-range hour or minute", () => {
    expect(isValidBedtime("24:00")).toBe(false);
    expect(isValidBedtime("21:60")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidBedtime("9:30")).toBe(false); // missing leading zero
    expect(isValidBedtime("21:30:00")).toBe(false);
    expect(isValidBedtime("bedtime")).toBe(false);
    expect(isValidBedtime("")).toBe(false);
  });
});

describe("setSleepIntent()", () => {
  const EMPTY: SleepIntentState = { intendedBedtime: null };

  it("sets a valid time", () => {
    expect(setSleepIntent(EMPTY, "22:30")).toEqual({ intendedBedtime: "22:30" });
  });

  it("replaces a previously set time", () => {
    const withIntent: SleepIntentState = { intendedBedtime: "22:00" };
    expect(setSleepIntent(withIntent, "23:15")).toEqual({ intendedBedtime: "23:15" });
  });

  it("THE REGRESSION GUARD: refuses a malformed time -- returns the state UNCHANGED, never coerces or throws", () => {
    expect(setSleepIntent(EMPTY, "not-a-time")).toBe(EMPTY);
    const withIntent: SleepIntentState = { intendedBedtime: "22:00" };
    expect(setSleepIntent(withIntent, "25:99")).toBe(withIntent);
  });
});

describe("clearSleepIntent()", () => {
  it("clears a set intent", () => {
    expect(clearSleepIntent({ intendedBedtime: "22:30" })).toEqual({ intendedBedtime: null });
  });

  it("is a no-op-equivalent (still null) on an already-empty state", () => {
    expect(clearSleepIntent({ intendedBedtime: null })).toEqual({ intendedBedtime: null });
  });
});
