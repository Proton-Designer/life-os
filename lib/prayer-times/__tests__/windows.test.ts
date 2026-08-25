import { describe, expect, it } from "vitest";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "../calculate";
import { computePrayerWindows } from "../windows";
import { getTimezoneOffsetMinutes, resolveLocalTime, localDateString } from "@/lib/date-utils";

const CHICAGO = { lat: 41.8781, lng: -87.6298, timezone: "America/Chicago" };

// calculatePrayerTimes' own `date` param reads UTC Y/M/D directly (no
// timezone awareness) — this is its real, still-current contract, used here
// only to independently cross-check computePrayerWindows' output. A caller
// of computePrayerWindows itself must pass a real instant, not this shape —
// see the noon-local `instantFor` helper below.
function timesFor(dateStr: string, calcMethod: CalcMethod = "MWL", asrMadhab: AsrMadhab = "standard") {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return calculatePrayerTimes({
    date,
    lat: CHICAGO.lat,
    lng: CHICAGO.lng,
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(date, CHICAGO.timezone),
    calcMethod,
    asrMadhab,
  });
}

// A real instant guaranteed to fall on `dateStr` in `timezone`, regardless
// of DST or which side of UTC the zone sits on — this is the shape every
// computePrayerWindows caller actually has (a real "now"), unlike a
// UTC-midnight stand-in, which is only ever correct by coincidence.
function instantFor(dateStr: string, timezone: string): Date {
  return resolveLocalTime(dateStr, "12:00", timezone);
}

describe("computePrayerWindows", () => {
  it("matches calculatePrayerTimes' own values for each window's start/end", () => {
    const dateStr = "2026-08-10";
    const date = instantFor(dateStr, CHICAGO.timezone);
    const today = timesFor(dateStr);
    const tomorrow = timesFor("2026-08-11");

    const windows = computePrayerWindows({
      date,
      lat: CHICAGO.lat,
      lng: CHICAGO.lng,
      timezone: CHICAGO.timezone,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });

    expect(windows.fajr?.start.getTime()).toBe(today.fajr.getTime());
    expect(windows.fajr?.end.getTime()).toBe(today.sunrise.getTime());
    expect(windows.dhuhr?.start.getTime()).toBe(today.dhuhr.getTime());
    expect(windows.dhuhr?.end.getTime()).toBe(today.asr.getTime());
    expect(windows.asr?.start.getTime()).toBe(today.asr.getTime());
    expect(windows.asr?.end.getTime()).toBe(today.maghrib.getTime());
    expect(windows.maghrib?.start.getTime()).toBe(today.maghrib.getTime());
    expect(windows.maghrib?.end.getTime()).toBe(today.isha.getTime());
    expect(windows.isha?.start.getTime()).toBe(today.isha.getTime());
    expect(windows.isha?.end.getTime()).toBe(tomorrow.fajr.getTime());
  });

  it("chains each window's end to the next window's start, from Dhuhr onward", () => {
    const date = instantFor("2026-08-10", CHICAGO.timezone);
    const windows = computePrayerWindows({
      date,
      lat: CHICAGO.lat,
      lng: CHICAGO.lng,
      timezone: CHICAGO.timezone,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });

    expect(windows.dhuhr?.end.getTime()).toBe(windows.asr?.start.getTime());
    expect(windows.asr?.end.getTime()).toBe(windows.maghrib?.start.getTime());
    expect(windows.maghrib?.end.getTime()).toBe(windows.isha?.start.getTime());
  });

  it("shifts Asr's start and Dhuhr's end together under the Hanafi madhab", () => {
    const date = instantFor("2026-08-10", CHICAGO.timezone);
    const base = { date, lat: CHICAGO.lat, lng: CHICAGO.lng, timezone: CHICAGO.timezone, calcMethod: "MWL" as const };
    const standard = computePrayerWindows({ ...base, asrMadhab: "standard" });
    const hanafi = computePrayerWindows({ ...base, asrMadhab: "hanafi" });

    expect(hanafi.asr?.start.getTime()).toBeGreaterThan(standard.asr?.start.getTime() as number);
    expect(hanafi.dhuhr?.end.getTime()).toBe(hanafi.asr?.start.getTime());
    expect(standard.dhuhr?.end.getTime()).toBe(standard.asr?.start.getTime());
  });

  it("computes tomorrow's timezone offset independently, so a DST transition overnight doesn't shift Isha's end by an hour", () => {
    // US DST ends (fall back) Nov 1, 2026 — Oct 31 is still CDT (UTC-5), Nov 1 becomes CST (UTC-6).
    const date = instantFor("2026-10-31", CHICAGO.timezone);
    const windows = computePrayerWindows({
      date,
      lat: CHICAGO.lat,
      lng: CHICAGO.lng,
      timezone: CHICAGO.timezone,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });
    // Independently computed using Nov 1's own (correct, post-transition) offset.
    const tomorrow = timesFor("2026-11-01");

    expect(windows.isha?.end.getTime()).toBe(tomorrow.fajr.getTime());
  });

  it("returns null for Fajr and Isha at a latitude/date where their twilight angle never occurs (white nights), never a lying Date", () => {
    // St. Petersburg-ish, summer solstice: sun's depression never reaches
    // MWL's 18° Fajr/Isha angle, but sunrise/sunset (0.833°) still occur.
    const date = instantFor("2026-06-21", "Europe/Moscow");
    const windows = computePrayerWindows({
      date,
      lat: 59.93,
      lng: 30.34,
      timezone: "Europe/Moscow",
      calcMethod: "MWL",
      asrMadhab: "standard",
    });

    expect(windows.fajr).toBeNull();
    expect(windows.isha).toBeNull();
    expect(windows.dhuhr).not.toBeNull();
    expect(windows.asr).not.toBeNull();
    expect(windows.maghrib).not.toBeNull();
  });

  // 2026-08-25 fix: calculatePrayerTimes reads a Date's UTC Y/M/D directly,
  // with no timezone awareness of its own — so passing a real "now" straight
  // through (as every production caller does) computed the WRONG day for
  // any instant already past the UTC calendar-day boundary in local time.
  // In a UTC-negative zone that's any local time from ~19:00 onward — the
  // exact bug Ayman hit at 21:07 CDT, where the ribbon rendered tomorrow's
  // (Tuesday's) prayer windows for a Monday evening, collapsing every one
  // of Monday's activity blocks to 0%.
  describe("day selection from a real instant (the 2026-08-25 UTC-rollover fix)", () => {
    it("uses TODAY's (not tomorrow's) windows for a UTC-negative zone in the evening — Ayman's exact failing case", () => {
      // 2026-08-25T02:07:00Z is 21:07 CDT on 2026-08-24 (America/Chicago, UTC-5).
      const now = new Date("2026-08-25T02:07:00Z");
      const windows = computePrayerWindows({
        date: now,
        lat: CHICAGO.lat,
        lng: CHICAGO.lng,
        timezone: CHICAGO.timezone,
        calcMethod: "MWL",
        asrMadhab: "standard",
      });
      const expectedToday = timesFor("2026-08-24");

      expect(windows.fajr?.start.getTime()).toBe(expectedToday.fajr.getTime());
      expect(windows.dhuhr?.start.getTime()).toBe(expectedToday.dhuhr.getTime());
      // 21:07 CDT falls inside Maghrib's window (open ~19:38 CDT, closes at
      // Isha ~21:14 CDT that evening) — under the bug, every window would
      // instead be Tuesday's, landing hours in the future and making 21:07
      // read as "before Fajr" (nowPosition === "before"), which is exactly
      // what Ayman's screenshot showed.
      expect(windows.maghrib?.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect((windows.maghrib?.end.getTime() ?? 0)).toBeGreaterThan(now.getTime());
    });

    it("returns the identical result on either side of the UTC midnight rollover, within the same CDT evening", () => {
      // 18:59 CDT and 19:01 CDT are both 2026-08-24 local — 23:59:00Z and
      // 2026-08-25T00:01:00Z respectively, straddling the UTC day boundary.
      const before = new Date("2026-08-24T23:59:00Z");
      const after = new Date("2026-08-25T00:01:00Z");
      const opts = { lat: CHICAGO.lat, lng: CHICAGO.lng, timezone: CHICAGO.timezone, calcMethod: "MWL" as const, asrMadhab: "standard" as const };

      const windowsBefore = computePrayerWindows({ date: before, ...opts });
      const windowsAfter = computePrayerWindows({ date: after, ...opts });

      expect(windowsBefore.fajr?.start.getTime()).toBe(windowsAfter.fajr?.start.getTime());
      expect(windowsBefore.isha?.start.getTime()).toBe(windowsAfter.isha?.start.getTime());
      expect(windowsBefore.isha?.end.getTime()).toBe(windowsAfter.isha?.end.getTime());
    });

    it("inverts correctly for a UTC-positive zone — early morning local is still the PREVIOUS UTC day (Asia/Karachi, UTC+5)", () => {
      // 2026-08-24T00:30 in Karachi (UTC+5) is 2026-08-23T19:30:00Z —
      // the previous UTC calendar day. Must still resolve to Aug 24 local.
      const now = new Date("2026-08-23T19:30:00Z");
      const windows = computePrayerWindows({
        date: now,
        lat: 24.8607,
        lng: 67.0011,
        timezone: "Asia/Karachi",
        calcMethod: "Karachi",
        asrMadhab: "hanafi",
      });

      expect(localDateString(windows.dhuhr!.start, "Asia/Karachi")).toBe("2026-08-24");
    });

    it("agrees exactly with the old UTC-Y/M/D behavior when timezone is UTC itself — no-regression anchor", () => {
      const now = new Date("2026-08-24T21:07:00Z");
      const windows = computePrayerWindows({
        date: now,
        lat: CHICAGO.lat,
        lng: CHICAGO.lng,
        timezone: "UTC",
        calcMethod: "MWL",
        asrMadhab: "standard",
      });
      // Old behavior: date.getUTCDate() straight off `now`, no reinterpretation.
      const oldBehaviorEquivalent = timesFor("2026-08-24");

      expect(windows.fajr?.start.getTime()).toBe(oldBehaviorEquivalent.fajr.getTime());
      expect(windows.dhuhr?.start.getTime()).toBe(oldBehaviorEquivalent.dhuhr.getTime());
    });
  });
});
