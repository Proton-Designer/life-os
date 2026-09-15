/**
 * #41 — the identity-habit decaying score. NEVER STORED: this is the pure
 * function that replays a habit's `habit_votes` log into a 0..1 score on
 * every read (migration 175's table comment on `habit_votes` says the
 * same). Nothing in this file talks to Supabase — callers (the /habits
 * reader, the Weekly Review habit-score summary, #48) pass in the vote
 * dates they already fetched.
 *
 * FORMULA (ruled 2026-09-14): `score_d = score_{d-1} * 0.96 + (voted_d ?
 * 0.04 : 0)`, starting at 0. Expanding the recurrence shows it is
 * algebraically identical to `0.04 * sum over each vote of
 * 0.96^(daysBetween(vote, asOf))` — computed here in that CLOSED FORM,
 * directly over the vote rows, rather than a day-by-day loop from the
 * habit's creation date. The two are equivalent because every day with no
 * vote contributes nothing but a `* 0.96` multiplier to whatever score
 * already exists, which is exactly what raising 0.96 to a higher power
 * already does for a vote further in the past — there is no day-zero
 * state to seed beyond "no votes yet contribute nothing," which the empty
 * sum already gives for free.
 *
 * A steady voter's score converges toward 1.0 (never storing a frozen
 * value that could go stale — see the table comment); a missed stretch
 * decays 4% per day it stays unvoted. Display as a 0-100% integer; this
 * function returns the 0..1 fraction, undecided by design (percent
 * rounding is a presentation choice for the reader, not this module's).
 *
 * "New" (habit under 7 days old shows "New" INSTEAD OF a score, per the
 * ruling) is NOT this module's job — it depends on `identity_habits.
 * created_at`, which this pure function never sees. The reader computes
 * that separately and skips calling this function entirely for a New habit.
 *
 * Calendar-date discipline (AGENTS.md, lib/date-utils.ts): every date here
 * is a YYYY-MM-DD LOCAL date string — `habit_votes.date`, always written
 * via `localDateString(now, tz)` — diffed with `Date.UTC` on
 * already-resolved calendar components, never `new Date(dateStr)` naive
 * parsing and never a raw instant. This is a local copy of the same idiom
 * `lib/self-mastery/session/exam-intensity.ts`'s own `daysBetweenDateStrings`
 * uses (that file's comment: "kept local to this file rather than added to
 * [lib/date-utils.ts], since it isn't owned here" — lib/habits isn't ULM's
 * either, so the copy stays local here too, not a cross-domain import).
 */

/** Per-day multiplicative decay -- a day with no vote shrinks the existing score by 4%. */
export const HABIT_DECAY_FACTOR = 0.96;

/** Per-vote contribution -- `1 - HABIT_DECAY_FACTOR`, kept as its own named constant so the two can never drift apart silently. */
export const HABIT_VOTE_WEIGHT = 1 - HABIT_DECAY_FACTOR;

/**
 * Calendar days from `fromStr` to `toStr` (both YYYY-MM-DD), positive when
 * `toStr` is later. Pure integer arithmetic on already-resolved calendar
 * components -- no instant, no timezone.
 *
 * Exported for reuse within lib/habits (queries.ts's "New" badge, under-7-
 * days-old check) -- kept a same-directory import rather than promoted to
 * lib/date-utils.ts, same reasoning lib/self-mastery/session/exam-
 * intensity.ts's own copy gives for staying local to its own owner.
 */
export function daysBetweenDateStrings(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromUTC = Date.UTC(fy!, fm! - 1, fd!);
  const toUTC = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((toUTC - fromUTC) / 86_400_000);
}

/** A closed (or still-open) pause window -- `resumedAt: null` means still paused as of whenever the caller's own `asOfDateStr` is. Both dates are local YYYY-MM-DD strings, same discipline as everything else in this file. */
export type HabitPauseRange = { pausedAt: string; resumedAt: string | null };

/**
 * P3-07 -- days within `[pausedAt, resumedAt ?? asOfDateStr)` that also fall
 * AFTER `voteDateStr` (a paused day before a vote was ever cast has nothing
 * to exclude it from) and on/before `asOfDateStr`. Plain string comparison
 * for the clipping bounds -- YYYY-MM-DD strings sort lexicographically
 * exactly like the dates they represent, so `>`/`<` here needs no parsing.
 */
function pausedDaysAfterVote(voteDateStr: string, asOfDateStr: string, range: HabitPauseRange): number {
  const rangeStart = range.pausedAt;
  const rangeEnd = range.resumedAt ?? asOfDateStr;
  const overlapStart = rangeStart > voteDateStr ? rangeStart : voteDateStr;
  const overlapEnd = rangeEnd < asOfDateStr ? rangeEnd : asOfDateStr;
  if (overlapEnd <= overlapStart) return 0;
  return daysBetweenDateStrings(overlapStart, overlapEnd);
}

/**
 * Replays a habit's vote log into its current decaying score, as of
 * `asOfDateStr` (a local YYYY-MM-DD date string -- pass `localDateString(now,
 * tz)`, never a raw `Date`). `voteDates` need not be sorted or deduplicated
 * -- `habit_votes_user_habit_date_key` (migration 175) already guarantees at
 * most one row per (habit, date) at the source, but this function does not
 * depend on that guarantee to be correct: a duplicate date would simply
 * double-count that one day's contribution, since each vote is summed
 * independently.
 *
 * A vote dated AFTER `asOfDateStr` is ignored rather than given a negative
 * exponent (which would amplify instead of decay) -- this should not occur
 * in practice (votes are only ever cast for the caller's own local today),
 * but a pure function should not produce a nonsensical score if it does.
 *
 * `pauseRanges` (P3-07, migration 202's own header has the full product
 * reasoning): every day spent paused is excluded from a vote's
 * days-elapsed count, PER VOTE -- a vote cast between two separate pause
 * windows is only offset by the pause that came after it, never by one
 * that already ended before the vote existed. Defaults to `[]` (every
 * existing caller before this change computes the exact same score it
 * always did).
 *
 * Returns a 0..1 fraction. Zero votes ever -> 0, exactly matching "refuses
 * to judge early" for a habit with no history yet (though the "New" badge,
 * per the ruling, is what actually covers a habit's first 7 days -- this
 * function has no opinion on badges).
 */
export function computeHabitDecayScore(
  voteDates: readonly string[],
  asOfDateStr: string,
  pauseRanges: readonly HabitPauseRange[] = []
): number {
  let score = 0;
  for (const voteDate of voteDates) {
    const rawDaysAgo = daysBetweenDateStrings(voteDate, asOfDateStr);
    if (rawDaysAgo < 0) continue;
    const pausedDays = pauseRanges.reduce((sum, range) => sum + pausedDaysAfterVote(voteDate, asOfDateStr, range), 0);
    const daysAgo = Math.max(0, rawDaysAgo - pausedDays);
    score += HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, daysAgo);
  }
  return score;
}
