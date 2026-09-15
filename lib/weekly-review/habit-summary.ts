import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { computeHabitDecayScore, daysBetweenDateStrings } from "@/lib/habits/decay-score";
import { getActiveHabitsWithVotes, NEW_HABIT_WINDOW_DAYS } from "@/lib/habits/queries";

type TypedClient = SupabaseClient<Database>;

export type HabitWeeklySummary = {
  id: string;
  identityStatement: string;
  isNew: boolean;
  /** 0..1, replayed as of `todayStr` -- NULL while `isNew`, same rule as the /habits page. */
  score: number | null;
  /** How many days in `[weekStartDate, weekEndDateExclusive)` this habit was voted for. */
  votesThisWeek: number;
};

/**
 * #48 — "trivial once #41 exists" per the build plan: reuses
 * lib/habits/queries.ts's getActiveHabitsWithVotes (the same raw fetch the
 * /habits page itself is built on) and lib/habits/decay-score.ts's
 * computeHabitDecayScore (the same replay function, same formula) rather
 * than re-deriving either. The only thing genuinely new here is
 * `votesThisWeek` — a plain count of the fetched vote-date list restricted
 * to the reviewed week's range.
 *
 * `todayStr` is the score's "as of" date (always the caller's real local
 * today, regardless of which week is being reviewed) — a habit's decaying
 * score is a CURRENT fact about it, not a historical snapshot as of the
 * reviewed week's end, so reviewing an old week does not retroactively
 * change what score is shown.
 */
export async function getHabitWeeklySummaries(
  supabase: TypedClient,
  userId: string,
  weekStartDate: string,
  weekEndDateExclusive: string,
  todayStr: string,
  timezone: string
): Promise<HabitWeeklySummary[]> {
  const rows = await getActiveHabitsWithVotes(supabase, userId);

  return rows.map((h) => {
    const createdLocalDate = localDateString(new Date(h.createdAt), timezone);
    const ageDays = daysBetweenDateStrings(createdLocalDate, todayStr);
    const isNew = ageDays < NEW_HABIT_WINDOW_DAYS;
    const votesThisWeek = h.voteDates.filter((d) => d >= weekStartDate && d < weekEndDateExclusive).length;
    return {
      id: h.id,
      identityStatement: h.identityStatement,
      isNew,
      // P3-07: pause-freeze applies here too -- the same habit's score
      // must read identically everywhere it's shown, not just on /habits.
      score: isNew ? null : computeHabitDecayScore(h.voteDates, todayStr, h.pauseRanges),
      votesThisWeek,
    };
  });
}
