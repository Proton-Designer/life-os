import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { computeHabitDecayScore, daysBetweenDateStrings, type HabitPauseRange } from "./decay-score";
import {
  computeDueState,
  computeFrequencyStreak,
  expectedRatePerDay,
  frequencyFromColumns,
  type HabitDueState,
  type HabitFrequency,
  type HabitStreak,
} from "./frequency";

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
  /** P2-11 -- total habit_votes rows ever cast for this habit, for the kill-flow's escalation gate (lib/habits/kill-escalation.ts). Display-only here; killIdentityHabitCore re-checks its own count server-side before actually gating. */
  voteCount: number;
  /** HABIT-FREQ: how often it is meant to happen (daily for every habit that never set one). */
  frequency: HabitFrequency;
  /** Today's state under that cadence: due today?, "2 of 3 this week", "Next: Wed". */
  due: HabitDueState;
  /** The current run in the cadence's own unit (days / weeks / months / in a row). */
  streak: HabitStreak;
};

export type HabitWithVotes = {
  id: string;
  identityStatement: string;
  rank: number;
  /** ISO instant, as stored -- callers convert to a local calendar date themselves via `localDateString`. */
  createdAt: string;
  voteDates: string[];
  /** HABIT-FREQ: how often it is meant to happen. */
  frequency: HabitFrequency;
  /** P3-07 -- every pause window this habit has EVER had (closed or still open), oldest first, for `computeHabitDecayScore`'s own decay-freeze math. A habit that has never been paused simply has an empty array, which is a genuine no-op for that function (default `[]` behaves identically to omitting the argument). */
  pauseRanges: HabitPauseRange[];
};

/**
 * `identity_habit_pauses` isn't in generated database.types.ts until
 * migration 202 is applied -- same local escape hatch `lib/ai/
 * morning-brief.ts`'s own header already established for the identical
 * reason. Delete once types regenerate.
 */
function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

/**
 * The shared raw fetch behind every habit-derived read: #39's /habits page
 * (via getActiveHabitsWithStatus below) and #48's Weekly Review habit-score
 * summary (lib/weekly-review/habit-summary.ts) both need "this user's
 * active habits, each with its full vote-date list" -- extracted here so
 * two independent copies of "select active identity_habits, then their
 * habit_votes, group by habit_id" don't drift the way
 * lib/evening-close/hours-today.ts's own header warns about for its own
 * query.
 *
 * Two queries (habits, then their votes) rather than a join, matching the
 * existing assembly style for this kind of small-table fan-out
 * (lib/distractions/queries.ts's assembleSummaries) -- personal per-user row
 * counts here are tiny (at most 7 habits), so aggregating in JS costs
 * nothing and keeps each query trivially indexable.
 */
export async function getActiveHabitsWithVotes(supabase: TypedClient, userId: string): Promise<HabitWithVotes[]> {
  const { data: habits, error: habitsError } = await supabase
    .from("identity_habits")
    .select("id, identity_statement, rank, created_at, frequency_type, frequency_count, frequency_days, frequency_interval")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("rank", { ascending: true });
  if (habitsError) throw habitsError;
  if (!habits || habits.length === 0) return [];

  const habitIds = habits.map((h) => h.id as string);
  const [{ data: votes, error: votesError }, { data: pausesRaw, error: pausesError }] = await Promise.all([
    supabase.from("habit_votes").select("habit_id, date").eq("user_id", userId).in("habit_id", habitIds),
    // P3-07 -- read-only, feeds decay-score.ts's own pause-freeze math below.
    untypedFrom(supabase, "identity_habit_pauses").select("habit_id, paused_at, resumed_at").eq("user_id", userId).in("habit_id", habitIds),
  ]);
  if (votesError) throw votesError;
  if (pausesError) throw pausesError;
  const pauses = (pausesRaw ?? []) as { habit_id: string; paused_at: string; resumed_at: string | null }[];

  const voteDatesByHabit = new Map<string, string[]>();
  for (const v of votes ?? []) {
    const habitId = v.habit_id as string;
    const list = voteDatesByHabit.get(habitId) ?? [];
    list.push(v.date as string);
    voteDatesByHabit.set(habitId, list);
  }

  const pauseRangesByHabit = new Map<string, HabitPauseRange[]>();
  for (const p of pauses) {
    const list = pauseRangesByHabit.get(p.habit_id) ?? [];
    list.push({ pausedAt: p.paused_at, resumedAt: p.resumed_at });
    pauseRangesByHabit.set(p.habit_id, list);
  }

  return habits.map((h) => ({
    id: h.id as string,
    identityStatement: h.identity_statement as string,
    rank: h.rank as number,
    createdAt: h.created_at as string,
    voteDates: voteDatesByHabit.get(h.id as string) ?? [],
    frequency: frequencyFromColumns(h),
    pauseRanges: pauseRangesByHabit.get(h.id as string) ?? [],
  }));
}

/**
 * #39/#40/#41's one combined read for the /habits page: this user's active
 * identity habits, each with today's vote state and its current decaying
 * score.
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
  const rows = await getActiveHabitsWithVotes(supabase, userId);

  return rows.map((h) => {
    // created_at is a timestamptz -- converted to the CALLER's local
    // calendar date via localDateString, never a UTC slice, so a habit
    // created late at night local time doesn't read as a day older than
    // it is (AGENTS.md's "never derive a calendar date from a raw Date").
    const createdLocalDate = localDateString(new Date(h.createdAt), timezone);
    const ageDays = daysBetweenDateStrings(createdLocalDate, todayStr);
    const isNew = ageDays < NEW_HABIT_WINDOW_DAYS;
    return {
      id: h.id,
      identityStatement: h.identityStatement,
      rank: h.rank,
      votedToday: h.voteDates.includes(todayStr),
      isNew,
      // The decay is per EXPECTED gap, not per calendar day, so a weekly habit isn't read as failing on its six off days.
      score: isNew ? null : computeHabitDecayScore(h.voteDates, todayStr, h.pauseRanges, expectedRatePerDay(h.frequency)),
      voteCount: h.voteDates.length,
      frequency: h.frequency,
      due: computeDueState(h.frequency, todayStr, { completedDates: h.voteDates, committedDate: createdLocalDate }),
      streak: computeFrequencyStreak(h.frequency, h.voteDates, todayStr, createdLocalDate),
    };
  });
}

export type PausedHabit = {
  id: string;
  identityStatement: string;
  rank: number;
};

/**
 * P3-07 -- this user's currently-paused habits, for the /habits page's own
 * "Paused" section (a Resume affordance, no score/vote state shown --
 * both are meaningless while paused, and showing a stale one would read
 * as current). No decay/vote data needed here, so this is deliberately
 * its own lean query rather than routed through `getActiveHabitsWithVotes`
 * (which is scoped to `status = 'active'` and would need widening for a
 * concern this function has no other reason to carry).
 */
export async function getPausedHabits(supabase: TypedClient, userId: string): Promise<PausedHabit[]> {
  const { data, error } = await supabase
    .from("identity_habits")
    .select("id, identity_statement, rank")
    .eq("user_id", userId)
    .eq("status", "paused")
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((h) => ({ id: h.id as string, identityStatement: h.identity_statement as string, rank: h.rank as number }));
}
