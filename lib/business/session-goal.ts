import { elapsedMinutesSince } from "./format-elapsed";

/**
 * Goal-based Lock-In sessions (146). Every function here is pure and
 * timezone-free: an ISO instant plus a duration in minutes is a second ISO
 * instant, computable without knowing anyone's calendar day — unlike
 * deriving a `YYYY-MM-DD` from an instant (AGENTS.md's timezone rule), which
 * this module never does. No `Date` is ever constructed from a bare
 * date-only string here.
 */

/** Ayman's slider ceiling (8h). A soft product preference, not a data
 * integrity invariant — migration 146 deliberately does NOT enforce this in
 * the database, so raising it later is a one-line change here, not a
 * migration. */
export const MAX_GOAL_MINUTES = 480;

/**
 * Validates an hours/minutes pair from the duration sliders into a total
 * goal in minutes. Throws (never returns a sentinel) on anything that isn't
 * a genuine duration — the caller (session-setup-dialog.tsx) is expected to
 * catch and surface the message, same convention as
 * lib/evening-close/rank-assignment.ts's assignRanks.
 *
 * `minutes > 59` is rejected rather than normalised (e.g. 75 minutes
 * silently becoming 1h15m) — the two sliders are independent controls with
 * independent ranges (0-8, 0-59); accepting an out-of-range minute value
 * would mean the function disagrees with what the slider itself can ever
 * produce, which is a bug waiting for a caller that isn't a slider.
 *
 * THE CAP IS ON THE TOTAL, NOT EACH FIELD INDEPENDENTLY. Hours 0-8 and
 * minutes 0-59 as independent ranges would admit 8h59m (539) — this rejects
 * any total over MAX_GOAL_MINUTES regardless of how it's split between the
 * two fields, so 8h + any nonzero minutes is invalid, matching "8 hours is
 * the ceiling" as Ayman would read it, not "8 is a valid value for the
 * hours field".
 */
export function parseGoalMinutes(hours: number, minutes: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error("Duration must be a whole number of hours and minutes.");
  }
  if (hours < 0 || minutes < 0) {
    throw new Error("Duration cannot be negative.");
  }
  if (minutes > 59) {
    throw new Error("Minutes must be between 0 and 59.");
  }
  const total = hours * 60 + minutes;
  if (total <= 0) {
    throw new Error("Choose a duration longer than zero.");
  }
  if (total > MAX_GOAL_MINUTES) {
    throw new Error(`Sessions can be at most ${MAX_GOAL_MINUTES / 60} hours.`);
  }
  return total;
}

/**
 * Parses the free-text duration field (session-setup-dialog.tsx) — a plain
 * whole number of total minutes, the same unit `parseGoalMinutes` returns,
 * so the two controls can stay synchronised without a lossy round trip
 * through a formatted "1h 30m" string. Whitespace is trimmed; anything that
 * isn't a bare non-negative integer (a decimal, a sign, "1h30m", empty) is
 * rejected outright rather than partially parsed — a text field that
 * silently interprets "90m" as 90 invites a user to type "1:30" and get 1.
 */
export function parseGoalMinutesText(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    throw new Error("Enter a whole number of minutes.");
  }
  const total = Number(trimmed);
  if (total <= 0) {
    throw new Error("Choose a duration longer than zero.");
  }
  if (total > MAX_GOAL_MINUTES) {
    throw new Error(`Sessions can be at most ${MAX_GOAL_MINUTES / 60} hours.`);
  }
  return total;
}

export type GoalProgress = {
  elapsedMinutes: number;
  goalMinutes: number;
  /** Clamped to [0, 1] — never negative (a session can't have started in the future from its own perspective) and never over 1 once the goal is passed. */
  fraction: number;
  reached: boolean;
};

/**
 * Progress against a session's goal at instant `now`. `elapsedMinutes`
 * reuses `elapsedMinutesSince` (format-elapsed.ts) — the same floor-to-whole-
 * minutes convention the overlay's un-goaled stopwatch already uses, so a
 * goaled and un-goaled session's elapsed number is computed identically and
 * can never disagree by a rounding rule alone.
 */
export function goalProgress(startedAtIso: string, goalMinutes: number, now: Date): GoalProgress {
  const elapsedMinutes = Math.max(0, elapsedMinutesSince(startedAtIso, now));
  const fraction = goalMinutes > 0 ? Math.min(1, elapsedMinutes / goalMinutes) : 0;
  return { elapsedMinutes, goalMinutes, fraction, reached: elapsedMinutes >= goalMinutes };
}

/**
 * The instant a session's goal is reached — `startedAt + goalMinutes`,
 * nothing else. Deliberately takes no `now`: this is the THE AUTO-END
 * TIMESTAMP RULE (Opus Lead, 146) — when a session auto-ends because its
 * goal was reached, the `ended_at` recorded must be this value, never the
 * wall-clock moment the app happened to notice. Two consequences fall out
 * of taking no `now` parameter, both load-bearing:
 *
 *   1. The recorded duration always equals the goal exactly (ended_at -
 *      started_at === goalMinutes), which is what feeds Business hours
 *      tracking — a session that ran the app-observed elapsed time instead
 *      would corrupt that metric by however late the check happened to run.
 *   2. It is correct for a REOPENED TAB by construction, not by a
 *      reopened-tab special case: a session left running overnight and
 *      found 14 hours later, past a 30-minute goal, still computes the same
 *      `startedAt + 30min` — there is no code path here that could read the
 *      14-hour gap and record it, because `now` never enters this function.
 *
 * The caller (Phase 3) is responsible for actually calling this rather than
 * `new Date().toISOString()` when ending a session for goal-reached — this
 * function only makes the correct value available, it cannot force its use.
 * The OTHER auto-end trigger (all objectives checked) uses the real `now()`
 * instead — that is the honest moment for that case, and does not go
 * through this function at all.
 */
export function goalEndsAtIso(startedAtIso: string, goalMinutes: number): string {
  return new Date(new Date(startedAtIso).getTime() + goalMinutes * 60_000).toISOString();
}
