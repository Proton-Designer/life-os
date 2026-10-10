import { DOMAIN_KEYS, STEP, emptyAllocation, minutesFor, type Allocation, type DomainKey } from "./allocation";
import { NOMINAL_PRAYER_MINUTES, type AllocationWindow, type TimeRange } from "./schedule";
import type { SessionRange } from "./session-accounting";

/**
 * Pre-fill derivation — pure functions, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-checkin-allocation-system.md, Phase 3
 * (owned here per the Lead's 2026-08-19 note: same overlap data the
 * suppression logic in schedule.ts already needs).
 *
 * Never a guess about *what* happened — only about *how much* of it landed
 * inside this specific window, computed from data the app already logged
 * (Deep Work / Deep Study sessions, logged prayers, a scheduled workout). The caller
 * (Engineer 2's `allocation-checkin.tsx`) takes the result as
 * `initialAllocation`, fully editable, marked subtly as pre-filled.
 *
 * Deen deliberately takes `loggedPrayerTimes: Date[]`, NOT prayer-window
 * overlap (2026-08-19 review catch, the worst bug this build almost
 * shipped): computePrayerWindows returns *validity* windows — Dhuhr's alone
 * can run 3+ hours — not durations, and a prayer remaining merely valid
 * during a window is not evidence he prayed for most of it. Deen sits on
 * the signal side of Signal:Noise, so overcounting it here would have
 * silently manufactured a flattering ratio out of nothing. Only a prayer
 * actually logged (status on_time/qada) whose real clock time falls inside
 * the window counts, and it counts for one nominal STEP — pre-fill only
 * ever fills what's *known*, and "the window was open" was never that.
 *
 * Fitness has the same shape, split across two independent inputs
 * (2026-08-19, same review): `workoutLoggedToday` is EVIDENCE (a
 * workout_sessions row exists for the date, per the Fitness redesign's
 * 2026-08-20 repoint off the dropped `workout_logs` — the session actually
 * happened), `scheduledWorkoutTime`/`scheduledWorkoutDurationMinutes` are
 * PLACEMENT (where in the day, and how long, per workout_schedule — a
 * plan, not proof). Neither alone is enough: a scheduled-but-unlogged
 * workout is exactly the prayer-window mistake in a new shape (crediting a
 * plan that may never have happened), and a logged-but-unplaced workout
 * has no window to go in — inventing one (e.g. from a session's
 * `created_at`, which is when it was *recorded*, not performed) risks the
 * wrong window entirely. Both present and the placement time falling in
 * this window is required; either one missing means no pre-fill, not a
 * guess.
 */

// Fallback only, per 023_workout_schedule_duration.sql — `duration_minutes`
// is nullable specifically so this stays the documented guess it always
// was, not dead code, whenever a schedule row hasn't set a real value.
const NOMINAL_WORKOUT_MINUTES = 30;

/** Minutes of overlap between a window and a range, snapped down to the nearest STEP, clamped to the window's own length. */
function overlapStepMinutes(window: AllocationWindow, range: TimeRange): number {
  const rangeEnd = range.end ?? window.end; // an open-ended (still-active) range overlaps at least up to "now" — the window itself, capped at its own end, is the safe upper bound here since resolveFireTime already keeps an open session's window out of the queue entirely.
  const overlapStart = Math.max(window.start.getTime(), range.start.getTime());
  const overlapEnd = Math.min(window.end.getTime(), rangeEnd.getTime());
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  const minutes = overlapMs / 60_000;
  return Math.floor(minutes / STEP) * STEP;
}

/** Overlap minutes per domain from the day's sessions: Deep Work -> Business, Deep Study -> School. A session with no domain credits nothing. */
function sessionMinutesByDomain(window: AllocationWindow, sessions: SessionRange[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of sessions) {
    if (s.domain === null) continue;
    totals[s.domain] = (totals[s.domain] ?? 0) + overlapStepMinutes(window, s);
  }
  for (const d of Object.keys(totals)) totals[d] = Math.floor(totals[d]! / STEP) * STEP;
  return totals;
}

/** One NOMINAL_PRAYER_MINUTES step per logged prayer whose real clock time falls inside the window — never a fraction, never a guess at duration. */
function loggedPrayerMinutes(window: AllocationWindow, loggedPrayerTimes: Date[]): number {
  const count = loggedPrayerTimes.filter(
    (t) => t.getTime() >= window.start.getTime() && t.getTime() < window.end.getTime()
  ).length;
  return count * NOMINAL_PRAYER_MINUTES;
}

/**
 * Derives a pre-fill `Allocation` for `window` from real, already-logged
 * data: Deep Work session overlap -> business and Deep Study overlap -> school
 * (the sessions account for themselves), a logged prayer's clock time
 * falling in the window -> deen (one nominal STEP each, see
 * loggedPrayerMinutes above), a workout that's BOTH logged AND scheduled
 * with a time falling inside this window -> fitness, using the schedule's
 * real `duration_minutes` when set and only falling back to
 * NOMINAL_WORKOUT_MINUTES when it isn't. Work has no data source to guess
 * from, so it is always left at 0 — genuinely unknown, not silently
 * assumed zero-effort.
 *
 * If sources together would exceed the window's own length (e.g. a
 * Lock-In session overlapping several logged prayers inside it —
 * double-booked data, not double-booked time), each domain keeps its own
 * share but the total is capped at the window length by scaling down
 * proportionally, snapped back to whole steps — never silently over 100%
 * of the window.
 */
export function derivePrefillAllocation(
  window: AllocationWindow,
  data: {
    lockInSessions: SessionRange[];
    loggedPrayerTimes: Date[];
    workoutLoggedToday: boolean;
    scheduledWorkoutTime: Date | null;
    scheduledWorkoutDurationMinutes: number | null;
  }
): Allocation {
  const sessionMinutes = sessionMinutesByDomain(window, data.lockInSessions);
  const deenMinutes = loggedPrayerMinutes(window, data.loggedPrayerTimes);
  const scheduledInWindow =
    data.scheduledWorkoutTime !== null &&
    data.scheduledWorkoutTime.getTime() >= window.start.getTime() &&
    data.scheduledWorkoutTime.getTime() < window.end.getTime();
  const fitnessMinutes =
    data.workoutLoggedToday && scheduledInWindow ? (data.scheduledWorkoutDurationMinutes ?? NOMINAL_WORKOUT_MINUTES) : 0;

  const raw: Allocation = { ...emptyAllocation(), ...sessionMinutes, deen: deenMinutes, fitness: fitnessMinutes };
  return capBelowFullWindow(raw, window);
}

function windowLengthMinutes(window: AllocationWindow): number {
  return (window.end.getTime() - window.start.getTime()) / 60_000;
}

/**
 * Scales every domain down proportionally, snapped to STEP, so the sum
 * never reaches the window's own length — reserving at least one STEP as
 * wasted even when real data alone would fill the whole window (e.g. a
 * Lock-In session spanning the entire 2h block). Per the Lead's ruling
 * (2026-08-19): pre-fill must never complete the window, since unassigned
 * time staying `wasted` is what makes correcting it — not just tapping
 * Done — the rewarded action. A no-op when already within bounds.
 */
function capBelowFullWindow(a: Allocation, window: AllocationWindow): Allocation {
  const limit = Math.max(0, windowLengthMinutes(window) - STEP);
  const sum = DOMAIN_KEYS.reduce((s, k) => s + minutesFor(a, k), 0);
  if (sum <= limit) return a;

  const scale = limit / sum;
  const scaled = { ...a };
  for (const key of DOMAIN_KEYS as DomainKey[]) {
    scaled[key] = Math.floor((minutesFor(a, key) * scale) / STEP) * STEP;
  }
  return scaled;
}
