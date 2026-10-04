/**
 * Insights "Rhythm" numbers (IA-P4a). Pure. Everything is a COUNT or a spread over the last N
 * days, never a score or a streak, and under MIN_POINTS data points it says nothing (an honest
 * empty state — a number from two nights is noise dressed as a result).
 */
export const MIN_POINTS = 3;

/** Local clock minutes-of-day (0..1439) of an instant in `timezone` — wall-clock parts via Intl, never UTC parts. */
export function localMinutesOfDay(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type WakeSpread = { n: number; earliest: string; latest: string; spreadMinutes: number; median: string };

/** Wake-time consistency from Start Day marks. null under MIN_POINTS. */
export function wakeSpread(wokeAtIsos: readonly string[], timezone: string): WakeSpread | null {
  if (wokeAtIsos.length < MIN_POINTS) return null;
  const mins = wokeAtIsos.map((iso) => localMinutesOfDay(iso, timezone)).sort((a, b) => a - b);
  const mid = Math.floor(mins.length / 2);
  const median = mins.length % 2 ? mins[mid]! : (mins[mid - 1]! + mins[mid]!) / 2;
  return { n: mins.length, earliest: formatClock(mins[0]!), latest: formatClock(mins[mins.length - 1]!), spreadMinutes: mins[mins.length - 1]! - mins[0]!, median: formatClock(median) };
}

export type CloseVsBedtime = { n: number; onTime: number; medianMinutesLate: number };

/**
 * When the evening close finished vs the planned bedtime ("HH:MM"). Signed difference wrapped to
 * [-12h, +12h) so a 00:30 close against a 23:00 bedtime is +90 (late), not -22.5h. onTime = closed at
 * or before bedtime. null under MIN_POINTS or without a bedtime.
 */
export function closeVsBedtime(closedAtIsos: readonly string[], bedtime: string | null, timezone: string): CloseVsBedtime | null {
  if (!bedtime || closedAtIsos.length < MIN_POINTS) return null;
  const bed = Number(bedtime.slice(0, 2)) * 60 + Number(bedtime.slice(3, 5));
  const diffs = closedAtIsos.map((iso) => {
    let d = localMinutesOfDay(iso, timezone) - bed;
    if (d >= 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
  });
  const sorted = [...diffs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { n: diffs.length, onTime: diffs.filter((d) => d <= 0).length, medianMinutesLate: Math.round(median) };
}
