import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString } from "@/lib/date-utils";
import { habitStage, type HabitStage, type StageOverride } from "@/lib/deen/habit-stage";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computeHabitRollingRate } from "@/lib/deen/habit-consistency";

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
  /** Rolling 30-day count (or since committed_date) — identical to the Faith page. */
  rollingRate: { done: number; total: number };
  streak: number;
};

export type FaithHabitRow = { id: string; name: string; committed_date: string; anchor_cue: string | null; stage_override: string | null };
export type FaithHabitLogRow = { habit_id: string; date: string; completed: boolean };

/** The Faith page's rolling-rate window start (dateStr − 29: thirty days including today). */
export function practiceWindowStart(dateStr: string): string {
  return addDaysToDateString(dateStr, -29);
}

/** The log window the maths needs: the Faith page reads sixty days (streaks look back further than the 30-day rate). */
export function practiceLogsSince(dateStr: string): string {
  return addDaysToDateString(dateStr, -59);
}

export function buildFaithPractices(habitRows: FaithHabitRow[], logRows: FaithHabitLogRow[], dateStr: string): FaithPractice[] {
  const windowStart = practiceWindowStart(dateStr);
  const logs = logRows.map((l) => ({ habitId: l.habit_id, date: l.date, completed: l.completed }));
  return habitRows.map((h) => {
    const habitLogs = logRows.filter((l) => l.habit_id === h.id);
    const completedDates = habitLogs.filter((l) => l.completed).map((l) => l.date);
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
      rollingRate: computeHabitRollingRate({ id: h.id, name: h.name, committedDate: h.committed_date }, logs, windowStart, dateStr),
      streak: computeHabitStreak(completedDates, dateStr),
    };
  });
}

/** Every non-archived practice for the user, with today's state. Call only when Deen mode is on. */
export async function getFaithPractices(supabase: SupabaseClient, userId: string, dateStr: string): Promise<FaithPractice[]> {
  const { data: habits, error: habitsError } = await supabase
    .from("deen_habits")
    .select("id, name, committed_date, anchor_cue, stage_override")
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
  return buildFaithPractices(habitRows, (logs ?? []) as FaithHabitLogRow[], dateStr);
}
