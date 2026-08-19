import { localDateString, resolveLocalTime } from "@/lib/date-utils";

/**
 * Check-in allocation scheduling — pure functions, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-checkin-allocation-system.md, Phase 3.
 *
 * The 2-hour grid is a CLOCK, not a timer: windows sit at fixed times
 * (derived once from wake/sleep bounds) and never shift, reset, or
 * re-anchor themselves. Interruptions (a short nominal span around a
 * prayer time, a recurring block, an active Lock-In session) only ever
 * delay a window's *fire time* — pushing it to the moment the interruption
 * ends — they never move the window's own boundaries or skip it outright.
 * That's what "resumes wherever it is when a session ends" means
 * concretely.
 *
 * Prayer suppression is deliberately a short nominal span, NOT
 * `computePrayerWindows`'s full validity window (2026-08-19 review catch):
 * Dhuhr's window alone can run 3+ hours, and suppressing a check-in for the
 * entire time a prayer remains merely *valid* would silence most of the
 * afternoon. See NOMINAL_PRAYER_MINUTES and prayerSuppressionRanges below.
 */

export const ALLOCATION_WINDOW_MINUTES = 120;

/**
 * A placeholder duration for "a prayer happened around here," used both to
 * build a short suppression span (below) and, in prefill.ts, to give a
 * logged prayer a nominal contribution to a pre-filled Deen allocation —
 * same honest-coarse-default pattern as prefill.ts's own
 * NOMINAL_WORKOUT_MINUTES, and the same value as one allocation STEP so a
 * single logged prayer maps to exactly one step, never a fraction of one.
 */
export const NOMINAL_PRAYER_MINUTES = 15;

/**
 * A short suppression span around a prayer's actual clock time (its
 * window's *start*, from computePrayerWindows) — not the full multi-hour
 * validity window. Applies to every one of a day's prayer times regardless
 * of whether it's been logged yet (suppression is prospective — "don't
 * interrupt around prayer time" — unlike prefill's pre-fill contribution,
 * which only counts prayers actually logged).
 */
export function prayerSuppressionRanges(prayerTimes: Date[]): TimeRange[] {
  return prayerTimes.map((start) => ({
    start,
    end: new Date(start.getTime() + NOMINAL_PRAYER_MINUTES * 60_000),
  }));
}

/** profiles.checkin_window_start / checkin_window_end ("HH:MM[:SS]" local clock time) — reused as-is, no new schema needed for wake/sleep bounds. */
export type WakeSleepBounds = { wakeTime: string; sleepTime: string };

export type AllocationWindow = { start: Date; end: Date };

/**
 * A suppression interval — a short nominal span around a prayer time (see
 * prayerSuppressionRanges, NOT computePrayerWindows' full validity window),
 * a user-defined recurring block (commute, gym), or an active Lock-In
 * session. `end: null` means "still open" (an in-progress session with no
 * `ended_at` yet): it suppresses everything from `start` onward,
 * indefinitely, until re-evaluated with a concrete end.
 */
export type TimeRange = { start: Date; end: Date | null };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Tiles [wakeTime, sleepTime] on `dateStr` into fixed, non-overlapping
 * `ALLOCATION_WINDOW_MINUTES`-long windows, local to `timezone`. A trailing
 * partial window is included if the wake/sleep span isn't an exact multiple
 * of the window length (fixed clock, not adaptive) — its `end` is clamped
 * to sleepTime rather than overshooting it.
 */
export function computeAllocationWindows(
  dateStr: string,
  bounds: WakeSleepBounds,
  timezone: string
): AllocationWindow[] {
  const startMin = toMinutes(bounds.wakeTime);
  const endMin = toMinutes(bounds.sleepTime);

  const windows: AllocationWindow[] = [];
  for (let t = startMin; t < endMin; t += ALLOCATION_WINDOW_MINUTES) {
    const windowEndMin = Math.min(t + ALLOCATION_WINDOW_MINUTES, endMin);
    windows.push({
      start: resolveLocalTime(dateStr, minutesToHHMM(t), timezone),
      end: resolveLocalTime(dateStr, minutesToHHMM(windowEndMin), timezone),
    });
  }
  return windows;
}

function minutesToHHMM(totalMinutes: number): string {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const m = String(totalMinutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function rangesOverlapInstant(instant: Date, range: TimeRange): boolean {
  if (instant.getTime() < range.start.getTime()) return false;
  if (range.end === null) return true;
  return instant.getTime() < range.end.getTime();
}

/**
 * The window's natural fire time (its own `end`) pushed past every
 * overlapping suppression range, in sequence, until it lands on an instant
 * covered by none of them. Returns `null` if it's still inside an
 * open-ended range (an in-progress Lock-In session) — not yet resolvable;
 * the caller re-evaluates once that session has a concrete `ended_at`.
 */
export function resolveFireTime(window: AllocationWindow, suppressionRanges: TimeRange[]): Date | null {
  let candidate = window.end;
  // Bounded by suppressionRanges.length passes: each pass can only push
  // `candidate` past one more range's end, and a range can only ever
  // matter once (its end is fixed), so this always terminates.
  for (let pass = 0; pass <= suppressionRanges.length; pass++) {
    const hit = suppressionRanges.find((r) => rangesOverlapInstant(candidate, r));
    if (!hit) return candidate;
    if (hit.end === null) return null;
    candidate = hit.end;
  }
  return candidate;
}

/**
 * True if every minute of `window` falls inside at least one of
 * `confirmedHourRanges` — the hourly Lock-In confirms, each an explicitly
 * answered (Yes or No) 60-minute span. Used to skip queuing a 2h window
 * that's already been fully accounted for hour-by-hour, so it isn't
 * re-asked about. Ranges are merged/coalesced first so adjacent or
 * overlapping hours combine into one continuous covered span before the
 * containment check.
 */
export function isWindowCoveredBySessionHours(window: AllocationWindow, confirmedHourRanges: TimeRange[]): boolean {
  const concrete = confirmedHourRanges.filter(
    (r): r is { start: Date; end: Date } => r.end !== null
  );
  if (concrete.length === 0) return false;

  const sorted = [...concrete].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: { start: Date; end: Date }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start.getTime() <= last.end.getTime()) {
      if (range.end.getTime() > last.end.getTime()) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }

  return merged.some((r) => r.start.getTime() <= window.start.getTime() && r.end.getTime() >= window.end.getTime());
}

export type AllocationSlotOutcome = "upcoming" | "pending_queue" | "expired_unknown" | "answered";

export type AllocationSlot = {
  window: AllocationWindow;
  fireTime: Date | null;
  outcome: AllocationSlotOutcome;
};

/**
 * Resolves every window's state for `dateStr` — the retroactive queue's
 * source of truth.
 *
 * Expiry is at the LOCAL END OF THE DAY the window belongs to, not a fixed
 * hour count after firing. This deliberately overrides the spec's original
 * ~4-hour figure: with real pre-fill (Lock-In sessions, prayer windows, a
 * scheduled workout — see prefill.ts), most of a window is a *confirmation*
 * of already-logged data, not free recall, so the memory-reliability
 * argument for a short fuse mostly doesn't apply to it. A same-day floor
 * still bounds the queue to at most one day's worth of windows, and matches
 * the day-boundary reset this app already uses elsewhere (Reflection).
 * Production evidence (0/23 check-ins ever answered, generation silently
 * dead since 8/15) is the other half of the argument: a short fuse plus no
 * working push notifications is how the previous system died. The queue
 * this produces IS the primary path, not a fallback.
 */
export function resolveAllocationSlots(opts: {
  dateStr: string;
  bounds: WakeSleepBounds;
  timezone: string;
  suppressionRanges: TimeRange[];
  now: Date;
  /** Window start times already answered, exact instant match. */
  answeredWindowStarts: Date[];
  /** Explicitly-answered (Yes or No) hourly Lock-In confirms — a window fully covered by these is treated as answered too, so it's never re-asked about. */
  confirmedSessionHourRanges?: TimeRange[];
}): AllocationSlot[] {
  const { dateStr, bounds, timezone, suppressionRanges, now, answeredWindowStarts, confirmedSessionHourRanges } = opts;

  const windows = computeAllocationWindows(dateStr, bounds, timezone);
  const answered = new Set(answeredWindowStarts.map((d) => d.getTime()));
  const nowDateStr = localDateString(now, timezone);
  const dayIsOver = dateStr < nowDateStr;

  return windows.map((window) => {
    if (
      answered.has(window.start.getTime()) ||
      isWindowCoveredBySessionHours(window, confirmedSessionHourRanges ?? [])
    ) {
      return { window, fireTime: window.end, outcome: "answered" };
    }

    const fireTime = resolveFireTime(window, suppressionRanges);

    // Genuinely unresolved (still inside an open-ended range, e.g. a
    // Lock-In session with no ended_at yet) is NOT the same as "fired and
    // nobody answered" — we don't yet know if/when this will fire, so it
    // can't be marked unknown just because the calendar day has passed.
    // Stays "upcoming" until the interruption actually ends.
    if (fireTime === null) {
      return { window, fireTime, outcome: "upcoming" };
    }
    if (fireTime.getTime() > now.getTime()) {
      return { window, fireTime, outcome: "upcoming" };
    }

    return { window, fireTime, outcome: dayIsOver ? "expired_unknown" : "pending_queue" };
  });
}

/** Oldest-first stack of currently-answerable, not-yet-expired slots — what a next-open should clear, one at a time, starting with the oldest. */
export function pendingQueue(slots: AllocationSlot[]): AllocationSlot[] {
  return slots
    .filter((s) => s.outcome === "pending_queue")
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
}

/** Count of windows that fired, were never answered, and are now permanently `unknown` — must be surfaced on its own, never hidden or folded into noise. */
export function unknownCount(slots: AllocationSlot[]): number {
  return slots.filter((s) => s.outcome === "expired_unknown").length;
}

/**
 * Which cadence applies right now. Inside an active Lock-In session the
 * 2-hour allocation clock is suppressed (via the session's own open-ended
 * `TimeRange`, same mechanism as prayer/recurring-block suppression) and an
 * hourly one-tap confirm takes over — reuse
 * `computeSessionCheckinSlots(startedAt, 60, now, answered)` for that half;
 * this function only tells the caller which half is currently live.
 */
export function activeCadence(activeSession: { startedAt: Date } | null): "session_hourly" | "allocation_window" {
  return activeSession ? "session_hourly" : "allocation_window";
}
