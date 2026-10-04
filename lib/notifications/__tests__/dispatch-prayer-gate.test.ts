import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldSendPrayerPush } from "../../../supabase/functions/dispatch-notifications/gate";

const WITH_LOCATION = { location_lat: 41.8, location_lng: -87.7 };

describe("dispatch-notifications prayer push gate", () => {
  it("sends only when Deen Mode is literally ON and a location exists", () => {
    expect(shouldSendPrayerPush({ ...WITH_LOCATION, deen_mode: true })).toBe(true);
  });

  it("skips when Deen Mode is OFF, even with a location (positive control: the old rule sent here)", () => {
    expect(shouldSendPrayerPush({ ...WITH_LOCATION, deen_mode: false })).toBe(false);
  });

  it("fails closed on null / missing deen_mode", () => {
    expect(shouldSendPrayerPush({ ...WITH_LOCATION, deen_mode: null })).toBe(false);
    expect(shouldSendPrayerPush({ ...WITH_LOCATION })).toBe(false);
  });

  it("still needs a location when ON", () => {
    expect(shouldSendPrayerPush({ deen_mode: true })).toBe(false);
    expect(shouldSendPrayerPush({ deen_mode: true, location_lat: 1, location_lng: null })).toBe(false);
  });

  // The pure gate is only worth anything if index.ts actually calls it and
  // selects the column -- guard the wiring, since the Deno file itself cannot
  // run under vitest.
  it("index.ts selects deen_mode and gates the prayer block on shouldSendPrayerPush", () => {
    const src = readFileSync("supabase/functions/dispatch-notifications/index.ts", "utf8");
    expect(src).toMatch(/\.select\("[^"]*\bdeen_mode\b[^"]*"\)/);
    expect(src).toContain("if (shouldSendPrayerPush(profile))");
    expect(src).not.toMatch(/if \(profile\.location_lat != null/);
  });
});
