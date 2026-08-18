import {
  calculatePrayerTimes,
  isSunAngleReachable,
  sunDeclinationDeg,
  METHOD_ANGLES,
  type CalcMethod,
  type AsrMadhab,
} from "./calculate";
import { getTimezoneOffsetMinutes } from "@/lib/date-utils";

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
  const tomorrow = nextCalendarDay(date);

  // Timezone offset resolved per date, not reused across the day boundary —
  // a DST transition between today and tomorrow otherwise shifts Isha's end
  // by an hour.
  const today = calculatePrayerTimes({
    date,
    lat,
    lng,
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(date, timezone),
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
  const todayDeclination = sunDeclinationDeg(date, lng);
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
