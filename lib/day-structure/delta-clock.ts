/**
 * Delta clock (#34) — minutes elapsed since the day's wake mark.
 *
 * DERIVED, NEVER STORED — same "derive at read time, a stored value always
 * wins over silence, but here there is no stored value to compete with"
 * convention as lib/deen/prayer-status.ts's effectivePrayerStatus and the
 * 2026-08-19 missed-Lock-In-hour ruling (.brain/memory/decisions.md, "no
 * cron, same derive-don't-write pattern"): there is no background job
 * ticking a counter forward and no race with a page load — it is correct
 * the instant `now` moves, because the only state this ever reads is the
 * ONE wake-mark instant (#33's `day_starts.woke_at`), which by construction
 * never changes after it is first set (no update policy on that table).
 *
 * Takes `wokeAtIso` (an instant) and `now` (an instant) — never a bare
 * calendar date and never a `new Date()` constructed internally, so this
 * function carries none of the AGENTS.md instant-vs-timezone risk itself;
 * the caller (lib/day-structure/day-start.ts) is what resolves "today" to
 * decide WHICH day's mark to read, a decision this function has no
 * opinion on and cannot get wrong on its behalf.
 *
 * Clamped at zero for the same reason lib/business/format-elapsed.ts
 * clamps `elapsedMinutesSince`: `wokeAtIso` is server-stamped, and a
 * client's own clock (or a stale prop from before a wake mark existed)
 * can trivially read as "after now".
 */
export function computeDeltaMinutes(wokeAtIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(wokeAtIso).getTime()) / 60_000));
}

/**
 * Same derivation as computeDeltaMinutes, at second precision — for the
 * ticking clock display only (components/day-structure/delta-clock-display.tsx).
 * Every other consumer (Efficiency's denominator, the close's Delta line)
 * wants whole minutes and should use computeDeltaMinutes instead; this
 * exists solely because a clock that visibly holds still for 59 seconds at
 * a time reads as broken, not as "correct at minute granularity".
 */
export function computeDeltaSeconds(wokeAtIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(wokeAtIso).getTime()) / 1000));
}

/** "3:42:17" (h:mm:ss) once past an hour, "8:03" (m:ss) before — a stopwatch face, not formatDurationMagnitude's rounded "41m" summary. */
export function formatDeltaClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
