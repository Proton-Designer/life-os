import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, effectiveDayString } from "@/lib/date-utils";

/**
 * Which day's tasks are "today's list" right now.
 *
 * An unfinished task stays on the list until the day is CLOSED (the evening close) or until 4 AM the next morning,
 * whichever comes first -- not at midnight. So:
 *   - the day being worked is the 4 AM-rollover day (effectiveDayString): 12:30 AM still belongs to yesterday's list;
 *   - once that day has an `evening_closes` mark, its list is done and the list moves on to the next day, i.e. the
 *     plan the person just made (planned_date / due_date = tomorrow).
 * Closing is keyed by the same effectiveDayString (plan-actions.ts commitPlan), so reading and writing agree.
 *
 * Only the TASK list uses this (plan lines, dated tasks, Kill List). Prayers, fitness and every per-calendar-day number
 * keep plain local dates.
 */
export function taskDayFor(now: Date, timezone: string, closedDates: ReadonlySet<string>): string {
  const base = effectiveDayString(now, timezone);
  return closedDates.has(base) ? addDaysToDateString(base, 1) : base;
}

export async function getTaskDay(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<string> {
  const base = effectiveDayString(now, timezone);
  const { data, error } = await supabase.from("evening_closes").select("local_date").eq("user_id", userId).eq("local_date", base).maybeSingle();
  if (error) throw error;
  return taskDayFor(now, timezone, new Set(data ? [base] : []));
}
