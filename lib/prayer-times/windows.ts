import {
  calculatePrayerTimes,
  isSunAngleReachable,
  sunDeclinationDeg,
  METHOD_ANGLES,
  type CalcMethod,
  type AsrMadhab,
} from "./calculate";
import { getTimezoneOffsetMinutes, localDateString } from "@/lib/date-utils";

export const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

export type PrayerWindow = { start: Date; end: Date };

// calculatePrayerTimes reads the calendar day off a Date's UTC Y/M/D — so
// "tomorrow" here must be the next UTC calendar day, not a local-timezone
// notion of tomorrow, to stay in agreement with it.
function nextCalendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/**
 * Fajr/Dhuhr/Asr/Maghrib/Isha as *windows*, not instants: [start, end) during
 * which a prayer is still valid to pray. Isha's window ends at the next
 * calendar day's Fajr (majority fiqh position — the stricter "Islamic
 * midnight" bound is a preferred-time hint, not the valid-until bound), so
 * this computes both today's and tomorrow's prayer times.
 *
 * A prayer's window is `null` when its defining angle is unreachable at this
 * latitude/date (high-latitude white nights / midnight sun) — callers must
 * never derive a missed status from a null window.
 */
export function computePrayerWindows(opts: {
  date: Date;
  lat: number;
  lng: number;
  timezone: string;
  calcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
}): Record<PrayerName, PrayerWindow | null> {
  const { date, lat, lng, timezone, calcMethod, asrMadhab } = opts;

  // `date` is a real instant — the calendar day it lands on depends on
  // `timezone`, never on UTC. calculatePrayerTimes/sunDeclinationDeg below
  // read a Date's UTC Y/M/D fields directly (no timezone awareness of their
  // own), so this anchors to the LOCAL day, re-encoded as UTC midnight —
  // the same shape lib/deen/prayer-status.ts's caller already builds from a
  // date string. Bug this fixes: any instant from ~19:00 local onward in a
  // UTC-negative zone (e.g. America/Chicago) has already rolled to the next
  // UTC calendar day, so every window computed after 7pm was tomorrow's,
  // not today's — collapsing today's ribbon activities to 0%.
  const todayAnchor = new Date(`${localDateString(date, timezone)}T00:00:00Z`);
  const tomorrow = nextCalendarDay(todayAnchor);

  // Timezone offset resolved per date, not reused across the day boundary —
  // a DST transition between today and tomorrow otherwise shifts Isha's end
  // by an hour.
  const today = calculatePrayerTimes({
    date: todayAnchor,
    lat,
    lng,
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(todayAnchor, timezone),
    calcMethod,
    asrMadhab,
  });
  const tomorrowTimes = calculatePrayerTimes({
    date: tomorrow,
    lat,
    lng,
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(tomorrow, timezone),
    calcMethod,
    asrMadhab,
  });

  const angles = METHOD_ANGLES[calcMethod];
  const todayDeclination = sunDeclinationDeg(todayAnchor, lng);
  const tomorrowDeclination = sunDeclinationDeg(tomorrow, lng);

  const fajrExistsToday = isSunAngleReachable(angles.fajr, lat, todayDeclination);
  const ishaExistsToday = isSunAngleReachable(angles.isha, lat, todayDeclination);
  const fajrExistsTomorrow = isSunAngleReachable(angles.fajr, lat, tomorrowDeclination);

  return {
    fajr: fajrExistsToday ? { start: today.fajr, end: today.sunrise } : null,
    dhuhr: { start: today.dhuhr, end: today.asr },
    asr: { start: today.asr, end: today.maghrib },
    maghrib: { start: today.maghrib, end: today.isha },
    isha: ishaExistsToday && fajrExistsTomorrow ? { start: today.isha, end: tomorrowTimes.fajr } : null,
  };
}
