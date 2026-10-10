import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanArea, type PlanArea } from "@/lib/plan/plan-behavior";

/**
 * One line of a day's plan as the plan stage / Edit Plan dialog shows it: the text plus everything the person has
 * already decided about it (star, crown, domain, Kill List, start time, timer, order). Plain serializable data, so it
 * crosses the Server -> Client boundary as a prop (never a function).
 */
export type PlanLineState = {
  id: string;
  title: string;
  starred: boolean;
  crowned: boolean;
  area: PlanArea | null;
  addToKillList: boolean;
  /** "HH:MM" 24h. */
  startTime: string | null;
  durationMinutes: number | null;
  /** Manual order (0-based) or null before the person has ordered anything. */
  order: number | null;
  /** Free-text criteria for the line, or null. */
  criteria: string | null;
  /** The Work tab (user_subdomains.key) the line was attached to, or null. */
  subdomain: string | null;
};

export const PLAN_LINE_COLUMNS = "id, title, mit_rank, plan_area, kill_list_item_id, planned_start_time, planned_duration_minutes, plan_order, plan_criteria, plan_subdomain, created_at";

type Row = {
  id: string;
  title: string;
  mit_rank: number | null;
  plan_area: string | null;
  kill_list_item_id: string | null;
  planned_start_time: string | null;
  planned_duration_minutes: number | null;
  plan_order: number | null;
  plan_criteria: string | null;
  plan_subdomain: string | null;
  created_at: string;
};

export function toPlanLineState(r: Row): PlanLineState {
  return {
    id: r.id,
    title: r.title,
    starred: r.mit_rank !== null,
    crowned: r.mit_rank === 1,
    area: isPlanArea(r.plan_area) ? r.plan_area : null,
    addToKillList: r.kill_list_item_id !== null,
    startTime: r.planned_start_time,
    durationMinutes: r.planned_duration_minutes,
    order: r.plan_order,
    criteria: r.plan_criteria,
    subdomain: r.plan_subdomain ?? null,
  };
}

/** The plan day's lines in the person's order (manual order first, then the order they were typed). */
export async function getPlanLines(supabase: SupabaseClient, userId: string, plannedDate: string): Promise<PlanLineState[]> {
  const { data, error } = await supabase.from("tasks").select(PLAN_LINE_COLUMNS).eq("user_id", userId).eq("planned_date", plannedDate).order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  return sortPlanRows(rows).map(toPlanLineState);
}

/** Manual order first (null last), creation order as the tiebreak. Pure; exported for the test. */
export function sortPlanRows<T extends { plan_order: number | null; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.plan_order ?? Number.POSITIVE_INFINITY;
    const bo = b.plan_order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
}
