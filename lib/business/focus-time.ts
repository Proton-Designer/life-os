/**
 * Sums Lock-In session durations — an unended session runs until `now`.
 * Relocated here from lib/home/ (Phase D) since focus time is a
 * Business-domain concept Home just displays cross-cutting.
 */
export function computeFocusTimeMinutes(
  sessions: { startedAt: Date; endedAt: Date | null }[],
  now: Date
): number {
  return sessions.reduce((total, s) => {
    const end = s.endedAt ?? now;
    return total + (end.getTime() - s.startedAt.getTime()) / 60_000;
  }, 0);
}
