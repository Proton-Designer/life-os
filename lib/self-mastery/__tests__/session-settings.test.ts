import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_NEW_LIMIT,
  DEFAULT_SESSION_MINUTES,
  MAX_DAILY_NEW_LIMIT,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  validateSelfMasterySettings,
} from "../session-settings";
import { MAX_SESSION_MINUTES_WITH_INTENSITY } from "../session/queue-limits";

const ok = { dailyNewLimit: 5, sessionTargetMinutes: 8 };

describe("validateSelfMasterySettings", () => {
  it("accepts the defaults and the edges of both ranges (positive controls)", () => {
    expect(validateSelfMasterySettings(ok)).toBeNull();
    expect(validateSelfMasterySettings({ dailyNewLimit: 0, sessionTargetMinutes: 5 })).toBeNull();
    expect(validateSelfMasterySettings({ dailyNewLimit: 50, sessionTargetMinutes: 20 })).toBeNull();
  });

  it("refuses new cards per day outside 0-50, fractional, or not a number", () => {
    for (const bad of [-1, 51, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
      expect(validateSelfMasterySettings({ ...ok, dailyNewLimit: bad as number }), String(bad)).toMatch(/New cards per day/);
    }
  });

  it("refuses a session length outside 5-20 minutes, fractional, or not a number", () => {
    for (const bad of [4, 21, 0, 8.5, Number.NaN, "8", null, undefined]) {
      expect(validateSelfMasterySettings({ ...ok, sessionTargetMinutes: bad as number }), String(bad)).toMatch(/Daily session length/);
    }
  });

  it("the ranges and defaults agree with the database and the session ceiling", () => {
    expect(MAX_DAILY_NEW_LIMIT).toBe(50); // user_settings_daily_new_limit_check (0..50)
    expect(DEFAULT_DAILY_NEW_LIMIT).toBe(5); // column default
    expect(DEFAULT_SESSION_MINUTES).toBe(8); // column default
    expect(MIN_SESSION_MINUTES).toBe(5);
    expect(MAX_SESSION_MINUTES).toBe(MAX_SESSION_MINUTES_WITH_INTENSITY); // one definition of the 20-minute ceiling
  });

  it("not an object -> refused, never throws", () => {
    expect(validateSelfMasterySettings(null as never)).not.toBeNull();
    expect(validateSelfMasterySettings(undefined as never)).not.toBeNull();
  });
});
