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
