/** "1h 25m" / "23m" for a Lock-In session's elapsed duration. Floors partial minutes. */
export function formatElapsedDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Whole minutes elapsed since `startedAtIso` — the full-screen Lock-In
 * overlay's stopwatch shows only this, never seconds or hours. Floors
 * partial minutes, same convention as formatElapsedDuration. */
export function elapsedMinutesSince(startedAtIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 60_000);
}
