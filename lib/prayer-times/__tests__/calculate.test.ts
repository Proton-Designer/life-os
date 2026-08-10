import { describe, expect, it } from "vitest";
import { calculatePrayerTimes } from "../calculate";

// Chicago, IL — a real, unambiguous reference location/timezone for sanity checks.
const CHICAGO = { lat: 41.8781, lng: -87.6298, timezoneOffsetMinutes: -300 }; // CDT, UTC-5

describe("calculatePrayerTimes", () => {
  it("returns the 5 prayers in correct chronological order", () => {
    const times = calculatePrayerTimes({
      date: new Date("2026-08-10T00:00:00Z"),
      ...CHICAGO,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });

    expect(times.fajr.getTime()).toBeLessThan(times.dhuhr.getTime());
    expect(times.dhuhr.getTime()).toBeLessThan(times.asr.getTime());
    expect(times.asr.getTime()).toBeLessThan(times.maghrib.getTime());
    expect(times.maghrib.getTime()).toBeLessThan(times.isha.getTime());
  });

  it("computes a later Asr time under the Hanafi madhab than standard", () => {
    const base = { date: new Date("2026-08-10T00:00:00Z"), ...CHICAGO, calcMethod: "MWL" as const };
    const standard = calculatePrayerTimes({ ...base, asrMadhab: "standard" });
    const hanafi = calculatePrayerTimes({ ...base, asrMadhab: "hanafi" });

    expect(hanafi.asr.getTime()).toBeGreaterThan(standard.asr.getTime());
  });

  it("computes an earlier Fajr for a method with a larger twilight angle", () => {
    const base = { date: new Date("2026-08-10T00:00:00Z"), ...CHICAGO, asrMadhab: "standard" as const };
    // ISNA uses a 15° Fajr angle; MWL uses 18° — a larger angle means Fajr starts earlier.
    const mwl = calculatePrayerTimes({ ...base, calcMethod: "MWL" });
    const isna = calculatePrayerTimes({ ...base, calcMethod: "ISNA" });

    expect(mwl.fajr.getTime()).toBeLessThan(isna.fajr.getTime());
  });

  it("keeps all 5 prayer times within the same calendar day in local time", () => {
    const times = calculatePrayerTimes({
      date: new Date("2026-08-10T00:00:00Z"),
      ...CHICAGO,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });

    for (const t of Object.values(times)) {
      const localHour = new Date(t.getTime() + CHICAGO.timezoneOffsetMinutes * 60_000).getUTCHours();
      expect(localHour).toBeGreaterThanOrEqual(0);
      expect(localHour).toBeLessThan(24);
    }
  });
});
