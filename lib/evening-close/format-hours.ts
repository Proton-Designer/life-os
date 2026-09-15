/**
 * "2:10" for the evening close's Hours line (R58).
 *
 * Not `formatElapsedDuration` ("1h 25m"), which is the Lock-In stopwatch's
 * convention. Changing that one to serve this screen would alter a surface
 * nobody asked me to touch; two formats in one app is a smaller cost than one
 * format that is wrong in one of its two homes.
 */
export function formatHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export const DAILY_HOUR_TARGET = 4;

/**
 * Phase 2 #P2-04's "N of 4 Hours today" -- a framing device on top of the
 * SAME `getHoursTodayMinutes` reader Merged Today already calls, not a new
 * capability: one "Hour" is a whole 60-minute unit of today's counted focus
 * time, floored, against a fixed daily target. Clamped at zero for the same
 * reason `formatHoursMinutes` is -- a negative input has no meaningful
 * "hours completed" count.
 */
export function hoursOfDailyTarget(minutes: number, target = DAILY_HOUR_TARGET): string {
  const completed = Math.floor(Math.max(0, minutes) / 60);
  return `${completed} of ${target}`;
}
