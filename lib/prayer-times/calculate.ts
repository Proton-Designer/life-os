// Standard sun-position / hour-angle prayer time calculation (the algorithm
// behind most open-source prayer time libraries — e.g. praytimes.org, adhan).
// Pure astronomical math, no external API dependency. Kept here as a shared
// module rather than duplicated: lib/home/get-priority-items.ts needs it now
// (Home's urgency bucketing depends on real prayer due-times — accuracy is a
// hard spec requirement, not cosmetic), and the Phase 14 push-notification
// Edge Function can reuse it later since both run in a JS-compatible runtime.

export type CalcMethod = "MWL" | "ISNA" | "Karachi" | "Egyptian";
export type AsrMadhab = "standard" | "hanafi";

export type PrayerTimes = {
  fajr: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
};

const METHOD_ANGLES: Record<CalcMethod, { fajr: number; isha: number }> = {
  MWL: { fajr: 18, isha: 17 },
  ISNA: { fajr: 15, isha: 15 },
  Karachi: { fajr: 18, isha: 18 },
  Egyptian: { fajr: 19.5, isha: 17.5 },
};

const MAGHRIB_ANGLE = 0.833; // standard sunset refraction angle

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}
function radToDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function julianDate(year: number, month: number, day: number): number {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    b -
    1524.5
  );
}

/** Sun declination (deg) and equation of time (minutes) for a given Julian date. */
function sunPosition(jd: number): { declination: number; equationOfTime: number } {
  const d = jd - 2451545.0;
  const g = degToRad((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const l = degToRad(
    (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g) + 360) % 360
  );
  const e = degToRad(23.439 - 0.00000036 * d);

  const declination = Math.asin(Math.sin(e) * Math.sin(l));

  const ra =
    radToDeg(Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l))) / 15;
  const raNormalized = ((ra % 24) + 24) % 24;
  const qHours = q / 15;
  let equationOfTime = qHours - raNormalized;
  // Normalize to [-12, 12] hours, then convert to minutes.
  if (equationOfTime > 12) equationOfTime -= 24;
  if (equationOfTime < -12) equationOfTime += 24;
  equationOfTime *= 60;

  return { declination: radToDeg(declination), equationOfTime };
}

/** Hour angle (in hours) for the sun to reach `angle` degrees below the horizon. */
function hourAngle(angle: number, lat: number, declination: number): number {
  const latRad = degToRad(lat);
  const declRad = degToRad(declination);
  const cosH =
    (-Math.sin(degToRad(angle)) - Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad));
  const clamped = Math.max(-1, Math.min(1, cosH));
  return radToDeg(Math.acos(clamped)) / 15;
}

/** Asr hour angle: sun altitude where shadow length = shadowFactor + tan(|lat - decl|). */
function asrHourAngle(shadowFactor: number, lat: number, declination: number): number {
  const latRad = degToRad(lat);
  const declRad = degToRad(declination);
  // Altitude above the horizon (positive). hourAngle()'s `angle` parameter is a
  // below-horizon depression angle, so an above-horizon altitude is passed negated.
  const altitude = Math.atan(
    1 / (shadowFactor + Math.tan(Math.abs(latRad - declRad)))
  );
  return hourAngle(-radToDeg(altitude), lat, declination);
}

/** `localClockHours` is a decimal local-clock-time (e.g. 12.8 = 12:48pm local). */
function localClockHoursToDate(date: Date, localClockHours: number, tzHours: number): Date {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const utcHours = localClockHours - tzHours;
  const totalMinutes = Math.round(utcHours * 60);
  result.setUTCMinutes(result.getUTCMinutes() + totalMinutes);
  return result;
}

export function calculatePrayerTimes(opts: {
  date: Date;
  lat: number;
  lng: number;
  timezoneOffsetMinutes: number;
  calcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
}): PrayerTimes {
  const { date, lat, lng, timezoneOffsetMinutes, calcMethod, asrMadhab } = opts;
  const tzHours = timezoneOffsetMinutes / 60;

  // Shift the Julian date by longitude to approximate the sun's position at
  // local solar noon for this calendar date (standard practice for this algorithm).
  const jd = julianDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const { declination, equationOfTime } = sunPosition(jd - lng / (15 * 24));

  // Local (zone-standard) clock time, NOT UTC — converted via localClockHoursToDate below.
  const dhuhrClock = 12 + tzHours - lng / 15 - equationOfTime / 60;

  const angles = METHOD_ANGLES[calcMethod];
  const fajrHA = hourAngle(angles.fajr, lat, declination);
  const ishaHA = hourAngle(angles.isha, lat, declination);
  const maghribHA = hourAngle(MAGHRIB_ANGLE, lat, declination);
  const asrHA = asrHourAngle(asrMadhab === "hanafi" ? 2 : 1, lat, declination);

  return {
    fajr: localClockHoursToDate(date, dhuhrClock - fajrHA, tzHours),
    dhuhr: localClockHoursToDate(date, dhuhrClock, tzHours),
    asr: localClockHoursToDate(date, dhuhrClock + asrHA, tzHours),
    maghrib: localClockHoursToDate(date, dhuhrClock + maghribHA, tzHours),
    isha: localClockHoursToDate(date, dhuhrClock + ishaHA, tzHours),
  };
}
