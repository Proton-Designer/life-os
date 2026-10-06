import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanArea, orderPlanItems, type PlanArea } from "@/lib/plan/plan-behavior";

/**
 * Today's plan as Home's plan list shows it: every task on today's plan the person COMMITTED to -- starred, attached
 * to a domain, or given a start time / timer. A bare dumped line (typed, never starred or detailed) stays out, the
 * same "dumped, not starred" rule the Night Plan has always had. Completed lines stay (crossed out) so the list is a
 * truer record of the day than one that deletes a line the moment it is done.
 */
export type PlanItem = {
  id: string;
  title: string;
  area: PlanArea | null;
  startTime: string | null;
  durationMinutes: number | null;
  /** ISO instant an inline timer was started, or null. */
  timerStartedAt: string | null;
  completed: boolean;
  mitRank: number | null;
  planOrder: number | null;
  /** The Kill List slot this line was mirrored into (Home shows the pair once, here). */
  killListItemId: string | null;
  classId: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  title: string;
  plan_area: string | null;
  planned_start_time: string | null;
  planned_duration_minutes: number | null;
  timer_started_at: string | null;
  completed: boolean;
  mit_rank: number | null;
  plan_order: number | null;
  kill_list_item_id: string | null;
  class_id: string | null;
  created_at: string;
};

export function toPlanItem(r: Row): PlanItem {
  return {
    id: r.id,
    title: r.title,
    area: isPlanArea(r.plan_area) ? r.plan_area : null,
    startTime: r.planned_start_time,
    durationMinutes: r.planned_duration_minutes,
    timerStartedAt: r.timer_started_at,
    completed: r.completed,
    mitRank: r.mit_rank,
    planOrder: r.plan_order,
    killListItemId: r.kill_list_item_id,
    classId: r.class_id,
    createdAt: r.created_at,
  };
}

export async function getTodaysPlanItems(supabase: SupabaseClient, userId: string, plannedDate: string): Promise<PlanItem[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, plan_area, planned_start_time, planned_duration_minutes, timer_started_at, completed, mit_rank, plan_order, kill_list_item_id, class_id, created_at")
    .eq("user_id", userId)
    .eq("planned_date", plannedDate)
    .or("mit_rank.not.is.null,plan_area.not.is.null,planned_start_time.not.is.null,planned_duration_minutes.not.is.null");
  if (error) throw error;
  return orderPlanItems(((data ?? []) as Row[]).map(toPlanItem));
}
