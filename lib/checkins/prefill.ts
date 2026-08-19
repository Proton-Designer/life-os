import { DOMAIN_KEYS, STEP, emptyAllocation, type Allocation, type DomainKey } from "./allocation";
import { NOMINAL_PRAYER_MINUTES, type AllocationWindow, type TimeRange } from "./schedule";

/**
 * Pre-fill derivation — pure functions, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-checkin-allocation-system.md, Phase 3
 * (owned here per the Lead's 2026-08-19 note: same overlap data the
 * suppression logic in schedule.ts already needs).
 *
 * Never a guess about *what* happened — only about *how much* of it landed
 * inside this specific window, computed from data the app already logged
 * (Lock-In sessions, logged prayers, a scheduled workout). The caller
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

function sumOverlapStepMinutes(window: AllocationWindow, ranges: TimeRange[]): number {
  const total = ranges.reduce((sum, r) => sum + overlapStepMinutes(window, r), 0);
  return Math.floor(total / STEP) * STEP;
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
 * data: Lock-In session overlap -> business, a logged prayer's clock time
 * falling in the window -> deen (one nominal STEP each, see
 * loggedPrayerMinutes above), a scheduled workout whose time falls inside
 * the window -> fitness, using its real `duration_minutes` when the
 * schedule row has one and only falling back to NOMINAL_WORKOUT_MINUTES
 * when it doesn't (2026-08-19, requested directly by Ayman — "why are we
 * guessing instead of storing it"). School and Co-op have no data source to
 * guess from, so they're always left at 0 — genuinely unknown, not
 * silently assumed zero-effort.
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
    lockInSessions: TimeRange[];
    loggedPrayerTimes: Date[];
    workoutTime: Date | null;
    workoutDurationMinutes: number | null;
  }
): Allocation {
  const businessMinutes = sumOverlapStepMinutes(window, data.lockInSessions);
  const deenMinutes = loggedPrayerMinutes(window, data.loggedPrayerTimes);
  const fitnessMinutes =
    data.workoutTime && data.workoutTime.getTime() >= window.start.getTime() && data.workoutTime.getTime() < window.end.getTime()
      ? (data.workoutDurationMinutes ?? NOMINAL_WORKOUT_MINUTES)
      : 0;

  const raw: Allocation = { ...emptyAllocation(), deen: deenMinutes, business: businessMinutes, fitness: fitnessMinutes };
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
  const sum = DOMAIN_KEYS.reduce((s, k) => s + a[k], 0);
  if (sum <= limit) return a;

  const scale = limit / sum;
  const scaled = { ...a };
  for (const key of DOMAIN_KEYS as DomainKey[]) {
    scaled[key] = Math.floor((a[key] * scale) / STEP) * STEP;
  }
  return scaled;
}
