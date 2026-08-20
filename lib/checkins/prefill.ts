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

function sumOverlapStepMinutes(window: AllocationWindow, ranges: TimeRange[]): number {
  const total = ranges.reduce((sum, r) => sum + overlapStepMinutes(window, r), 0);
  return Math.floor(total / STEP) * STEP;
}

/**
 * Removes every RESOLVED hourly Lock-In hour from `sessions` before they
 * ever reach the coarse overlap-based business credit above — 2026-08-19,
 * the double-count guard for the hourly confirm feature. "Resolved" means
 * the hour has a definite value from one of two sources (widened
 * 2026-08-19, docs/superpowers/specs/2026-08-19-missed-lockin-hours.md;
 * originally answered-only): explicitly answered (a real
 * checkin_allocations row, business for Yes / wasted for No), OR
 * auto-missed — superseded and unconfirmed, DERIVED as wasted with no row
 * written (see session-hour-status.ts's resolveSessionHours) but just as
 * definite a value as an explicit answer for this guard's purposes. Either
 * way, a resolved hour must never ALSO be coarse-credited by
 * session-overlap for the same 60 minutes: a wasted hour (answered "No" or
 * auto-missed) double-counted as business would silently reverse the very
 * drift both the confirm and the missed-hour ruling exist to catch, and a
 * "Yes" hour would just double-count the same real minutes twice.
 *
 * The one hour deliberately left alone — not subtracted — is the CURRENT
 * PENDING due slot, if any: it hasn't resolved yet either way, and keeps
 * falling back to the coarse credit exactly as every not-yet-fired hour
 * already does. That's the only remaining case of the original
 * already-accepted inference (session presence implies probable business
 * time); this function replaces that inference with a precise one
 * wherever a definite value exists (answered or missed), and only ever
 * removes evidence for the one hour that's still genuinely unknown.
 *
 * Call once per queue-build with the day's resolved hours, then pass the
 * result as `lockInSessions` into every window's derivePrefillAllocation
 * call — cheaper than re-subtracting per window, and keeps this function's
 * signature independent of any single window.
 *
 * Deliberately per-HOUR, not per-window (2026-08-19, corrects the Lead's own
 * first instinct): a window-level "is this window fully covered by resolved
 * hours?" check (see schedule.ts's isWindowCoveredBySessionHours, which
 * exists for the separate re-queue-suppression concern) is not sufficient
 * here. A 2h window with ONE of its two hours resolved and the other still
 * open/pending is not fully covered, so a window-level check leaves it
 * alone — but the resolved hour inside it must still be subtracted, or that
 * hour's minutes get counted twice: once from its own real value (a stored
 * row, or the missed-hour derivation), once again inside the coarse
 * session-overlap credit for the window's still-pending boundary hour.
 * Subtracting per-hour handles both the fully-covered and
 * partially-covered cases correctly in one pass, for both answered AND
 * missed hours; do not "simplify" this back to a window-coverage check.
 */
export function subtractResolvedHours(sessions: TimeRange[], resolvedHourRanges: TimeRange[]): TimeRange[] {
  const confirmed = resolvedHourRanges.filter((r): r is { start: Date; end: Date } => r.end !== null);
  if (confirmed.length === 0) return sessions;

  const result: TimeRange[] = [];
  for (const session of sessions) {
    let pieces: { start: number; end: number | null }[] = [
      { start: session.start.getTime(), end: session.end ? session.end.getTime() : null },
    ];

    for (const c of confirmed) {
      const cStart = c.start.getTime();
      const cEnd = c.end.getTime();
      const next: typeof pieces = [];
      for (const p of pieces) {
        const noOverlap = (p.end !== null && cEnd <= p.start) || cStart >= (p.end ?? Infinity);
        if (noOverlap) {
          next.push(p);
          continue;
        }
        if (cStart > p.start) next.push({ start: p.start, end: cStart });
        if (p.end === null) next.push({ start: cEnd, end: null });
        else if (cEnd < p.end) next.push({ start: cEnd, end: p.end });
      }
      pieces = next;
    }

    for (const p of pieces) {
      if (p.end !== null && p.end <= p.start) continue; // fully consumed
      result.push({ start: new Date(p.start), end: p.end === null ? null : new Date(p.end) });
    }
  }
  return result;
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
 * loggedPrayerMinutes above), a workout that's BOTH logged AND scheduled
 * with a time falling inside this window -> fitness, using the schedule's
 * real `duration_minutes` when set and only falling back to
 * NOMINAL_WORKOUT_MINUTES when it isn't. School and Co-op have no data
 * source to guess from, so they're always left at 0 — genuinely unknown,
 * not silently assumed zero-effort.
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
    workoutLoggedToday: boolean;
    scheduledWorkoutTime: Date | null;
    scheduledWorkoutDurationMinutes: number | null;
  }
): Allocation {
  const businessMinutes = sumOverlapStepMinutes(window, data.lockInSessions);
  const deenMinutes = loggedPrayerMinutes(window, data.loggedPrayerTimes);
  const scheduledInWindow =
    data.scheduledWorkoutTime !== null &&
    data.scheduledWorkoutTime.getTime() >= window.start.getTime() &&
    data.scheduledWorkoutTime.getTime() < window.end.getTime();
  const fitnessMinutes =
    data.workoutLoggedToday && scheduledInWindow ? (data.scheduledWorkoutDurationMinutes ?? NOMINAL_WORKOUT_MINUTES) : 0;

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
