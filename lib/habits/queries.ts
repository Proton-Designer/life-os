import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { computeHabitDecayScore, daysBetweenDateStrings } from "./decay-score";

type TypedClient = SupabaseClient<Database>;

/** A habit is "New" (spec: "refuses to judge early") for its first 7 local days. */
export const NEW_HABIT_WINDOW_DAYS = 7;

export type HabitWithStatus = {
  id: string;
  identityStatement: string;
  rank: number;
  votedToday: boolean;
  isNew: boolean;
  /** 0..1, replayed from the vote log -- NULL while `isNew` (the spec refuses to judge early, not "shows a low number"). */
  score: number | null;
};

/**
 * #39/#40/#41's one combined read: this user's active identity habits,
 * each with today's vote state and its current decaying score. Two queries
 * (habits, then their votes) rather than a join, matching the existing
 * assembly style for this kind of small-table fan-out (lib/distractions/
 * queries.ts's assembleSummaries) -- personal per-user row counts here are
 * tiny (at most 7 habits), so aggregating in JS costs nothing and keeps
 * each query trivially indexable.
 *
 * `todayStr` and `timezone` are the caller's already-resolved values
 * (typically `localDateString(now, timezone)`) -- this function does not
 * derive "today" itself, so it carries no timezone risk of its own, same
 * discipline as lib/evening-close/hours-today.ts's getHoursTodayMinutes.
 */
export async function getActiveHabitsWithStatus(
  supabase: TypedClient,
  userId: string,
  todayStr: string,
  timezone: string
): Promise<HabitWithStatus[]> {
  const { data: habits, error: habitsError } = await supabase
    .from("identity_habits")
    .select("id, identity_statement, rank, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("rank", { ascending: true });
  if (habitsError) throw habitsError;
  if (!habits || habits.length === 0) return [];

  const habitIds = habits.map((h) => h.id as string);
  const { data: votes, error: votesError } = await supabase
    .from("habit_votes")
    .select("habit_id, date")
    .eq("user_id", userId)
    .in("habit_id", habitIds);
  if (votesError) throw votesError;

  const voteDatesByHabit = new Map<string, string[]>();
  for (const v of votes ?? []) {
    const habitId = v.habit_id as string;
    const list = voteDatesByHabit.get(habitId) ?? [];
    list.push(v.date as string);
    voteDatesByHabit.set(habitId, list);
  }

  return habits.map((h) => {
    const voteDates = voteDatesByHabit.get(h.id as string) ?? [];
    // created_at is a timestamptz -- converted to the CALLER's local
    // calendar date via localDateString, never a UTC slice, so a habit
    // created late at night local time doesn't read as a day older than
    // it is (AGENTS.md's "never derive a calendar date from a raw Date").
    const createdLocalDate = localDateString(new Date(h.created_at as string), timezone);
    const ageDays = daysBetweenDateStrings(createdLocalDate, todayStr);
    const isNew = ageDays < NEW_HABIT_WINDOW_DAYS;
    return {
      id: h.id as string,
      identityStatement: h.identity_statement as string,
      rank: h.rank as number,
      votedToday: voteDates.includes(todayStr),
      isNew,
      score: isNew ? null : computeHabitDecayScore(voteDates, todayStr),
    };
  });
}
