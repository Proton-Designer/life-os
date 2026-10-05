import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString } from "@/lib/date-utils";
import { habitStage, type HabitStage, type StageOverride } from "@/lib/deen/habit-stage";
import {
  computeAdherence,
  computeDueState,
  computeFrequencyStreak,
  frequencyFromColumns,
  type HabitDueState,
  type HabitFrequency,
  type HabitStreak,
} from "@/lib/habits/frequency";

/**
 * HABITS-01 — the Faith screen's habit-builder practices (deen_habits), read for Home's habit check-offs and
 * the weekly reset's step 3. ONE derivation shared with the Faith page (`buildFaithPractices`): same streak,
 * same 30-day rolling rate, same stage-override rules. Deen OFF is the CALLER's gate: when it is off this
 * reader must not be called at all (nothing read, nothing shown); deen data is never touched.
 */
export type FaithPractice = {
  id: string;
  name: string;
  anchorCue: string | null;
  committedDate: string;
  completedToday: boolean;
  /** habitStage(): the manual pin wins, otherwise derived from committedDate. */
  stage: HabitStage;
  stageOverride: StageOverride;
  /** How often it is meant to happen (HABIT-FREQ). Daily for every habit that never set one. */
  frequency: HabitFrequency;
  /** Today's state under that cadence: is it due today, "2 of 3 this week", "Next: Wed", … */
  due: HabitDueState;
  /** Adherence over the last 30 days in the cadence's own unit (days for daily — identical to the Faith page's original "N of 30"; weeks / months / completions otherwise). */
  rollingRate: { done: number; total: number; unit?: "day" | "week" | "month" | "completion" };
  /** The streak COUNT (days for a daily habit). `streakInfo` carries the unit for a correct label. */
  streak: number;
  streakInfo: HabitStreak;
};

export type FaithHabitRow = {
  id: string;
  name: string;
  committed_date: string;
  anchor_cue: string | null;
  stage_override: string | null;
  frequency_type?: string | null;
  frequency_count?: number | null;
  frequency_days?: number[] | null;
  frequency_interval?: number | null;
};

/** The deen_habits columns every practice reader selects — one string so the Faith page, Home and the weekly reset can't drift. */
export const FAITH_HABIT_COLUMNS = "id, name, committed_date, anchor_cue, stage_override, frequency_type, frequency_count, frequency_days, frequency_interval";
export type FaithHabitLogRow = { habit_id: string; date: string; completed: boolean };

/** The Faith page's rolling-rate window start (dateStr − 29: thirty days including today). */
export function practiceWindowStart(dateStr: string): string {
  return addDaysToDateString(dateStr, -29);
}

/** The log window the maths needs: the Faith page reads sixty days (streaks look back further than the 30-day rate). */
export function practiceLogsSince(dateStr: string): string {
  return addDaysToDateString(dateStr, -59);
}

/**
 * HABIT-FREQ: how far back a FLEXIBLE habit's logs are read. The 60-day window above is plenty for a daily habit, but a
 * "once a month" streak needs many months of history. Flexible cadences log few rows (a handful a month), so the longer
 * read stays well under the API's 1000-row cap; daily / certain-days habits keep the original 60-day read.
 */
export const FLEXIBLE_LOOKBACK_DAYS = 400;

const isFlexible = (h: FaithHabitRow) => h.frequency_type === "per_week" || h.frequency_type === "per_month" || h.frequency_type === "every_n_days";

/** The older log rows (before the standard 60-day window) for the flexible habits only; [] when there are none. */
export async function getOlderFlexibleLogs(supabase: SupabaseClient, userId: string, habitRows: FaithHabitRow[], dateStr: string): Promise<FaithHabitLogRow[]> {
  const ids = habitRows.filter(isFlexible).map((h) => h.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("deen_habit_logs")
    .select("habit_id, date, completed")
    .eq("user_id", userId)
    .in("habit_id", ids)
    .gte("date", addDaysToDateString(dateStr, -FLEXIBLE_LOOKBACK_DAYS))
    .lt("date", practiceLogsSince(dateStr));
  if (error) throw new Error(`getOlderFlexibleLogs: ${error.message}`);
  return (data ?? []) as FaithHabitLogRow[];
}

export function buildFaithPractices(habitRows: FaithHabitRow[], logRows: FaithHabitLogRow[], dateStr: string): FaithPractice[] {
  const windowStart = practiceWindowStart(dateStr);
  return habitRows.map((h) => {
    const habitLogs = logRows.filter((l) => l.habit_id === h.id);
    const completedDates = habitLogs.filter((l) => l.completed).map((l) => l.date);
    const frequency = frequencyFromColumns(h);
    const streakInfo = computeFrequencyStreak(frequency, completedDates, dateStr, h.committed_date);
    // The column is a plain string in the generated types; habitStage() validates at runtime and falls back to the derived stage.
    const stageOverride = h.stage_override as StageOverride;
    return {
      id: h.id,
      name: h.name,
      anchorCue: h.anchor_cue,
      committedDate: h.committed_date,
      completedToday: habitLogs.some((l) => l.date === dateStr && l.completed),
      stage: habitStage(h.committed_date, dateStr, stageOverride),
      stageOverride,
      frequency,
      due: computeDueState(frequency, dateStr, { completedDates, committedDate: h.committed_date }),
      rollingRate: computeAdherence(frequency, completedDates, windowStart, dateStr, h.committed_date),
      streak: streakInfo.count,
      streakInfo,
    };
  });
}

/** Every non-archived practice for the user, with today's state. Call only when Deen mode is on. */
export async function getFaithPractices(supabase: SupabaseClient, userId: string, dateStr: string): Promise<FaithPractice[]> {
  const { data: habits, error: habitsError } = await supabase
    .from("deen_habits")
    .select(FAITH_HABIT_COLUMNS)
    .eq("user_id", userId)
    .eq("archived", false);
  if (habitsError) throw new Error(`getFaithPractices: ${habitsError.message}`);
  const habitRows = (habits ?? []) as FaithHabitRow[];
  if (habitRows.length === 0) return [];
  const { data: logs, error: logsError } = await supabase
    .from("deen_habit_logs")
    .select("habit_id, date, completed")
    .eq("user_id", userId)
    .in("habit_id", habitRows.map((h) => h.id))
    .gte("date", practiceLogsSince(dateStr));
  if (logsError) throw new Error(`getFaithPractices: ${logsError.message}`);
  const older = await getOlderFlexibleLogs(supabase, userId, habitRows, dateStr);
  return buildFaithPractices(habitRows, [...((logs ?? []) as FaithHabitLogRow[]), ...older], dateStr);
}
