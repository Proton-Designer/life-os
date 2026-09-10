/**
 * "1h 25m" / "23m" for a Lock-In session's elapsed duration. Floors
 * partial minutes.
 *
 * CLAMPED AT ZERO, not at each call site. A session's `started_at` is
 * server-stamped; the browser's own clock can trivially be behind it (a
 * Vercel cold start is enough), which makes `now - startedAt` negative for
 * a session that only just began. Two callers already wrapped this in
 * `Math.max(0, ...)` (components/business/lock-in-overlay.tsx,
 * lib/business/session-goal.ts); three others didn't
 * (components/home/focus-module.tsx, components/business/lock-in-session.tsx,
 * components/home/domain-peek-cards.tsx) and rendered "-1m" live in
 * production. Fixed at the chokepoint so no future caller can bypass it —
 * the existing `Math.max(0, ...)` wrappers become redundant, not wrong, so
 * they're left as-is rather than stripped out as a drive-by.
 *
 * Clamping here also fixes a second, nastier bug: for a negative input the
 * `hours > 0` branch never fires (hours is itself negative), so an
 * HOUR-scale clock/timezone error was being discarded down to a
 * trivial-looking "-1m" instead of showing its real magnitude. Clamping to
 * 0 is still the right fix (not preserving the negative magnitude) — "how
 * early" was never a number this UI needs to show; "never negative" is
 * the actual requirement.
 */
export function formatElapsedDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Whole minutes elapsed since `startedAtIso` — the full-screen Lock-In
 * overlay's stopwatch shows only this, never seconds or hours. Floors
 * partial minutes, same convention as formatElapsedDuration. Clamped at
 * zero for the same reason — `startedAtIso` can be trivially ahead of the
 * caller's own clock.
 */
export function elapsedMinutesSince(startedAtIso: string, now: Date): number {
  return Math.floor(Math.max(0, now.getTime() - new Date(startedAtIso).getTime()) / 60_000);
}
