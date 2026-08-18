import { describe, expect, it } from "vitest";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "../calculate";
import { computePrayerWindows } from "../windows";
import { getTimezoneOffsetMinutes } from "@/lib/date-utils";

const CHICAGO = { lat: 41.8781, lng: -87.6298, timezone: "America/Chicago" };

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

describe("computePrayerWindows", () => {
  it("matches calculatePrayerTimes' own values for each window's start/end", () => {
    const dateStr = "2026-08-10";
    const date = new Date(`${dateStr}T00:00:00Z`);
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
    const date = new Date("2026-08-10T00:00:00Z");
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
    const date = new Date("2026-08-10T00:00:00Z");
    const base = { date, lat: CHICAGO.lat, lng: CHICAGO.lng, timezone: CHICAGO.timezone, calcMethod: "MWL" as const };
    const standard = computePrayerWindows({ ...base, asrMadhab: "standard" });
    const hanafi = computePrayerWindows({ ...base, asrMadhab: "hanafi" });

    expect(hanafi.asr?.start.getTime()).toBeGreaterThan(standard.asr?.start.getTime() as number);
    expect(hanafi.dhuhr?.end.getTime()).toBe(hanafi.asr?.start.getTime());
    expect(standard.dhuhr?.end.getTime()).toBe(standard.asr?.start.getTime());
  });

  it("computes tomorrow's timezone offset independently, so a DST transition overnight doesn't shift Isha's end by an hour", () => {
    // US DST ends (fall back) Nov 1, 2026 — Oct 31 is still CDT (UTC-5), Nov 1 becomes CST (UTC-6).
    const date = new Date("2026-10-31T00:00:00Z");
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
    const date = new Date("2026-06-21T00:00:00Z");
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
});
