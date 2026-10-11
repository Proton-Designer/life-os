import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LINE_COLUMNS, sortPlanRows, toPlanLineState, type PlanLineState } from "@/lib/night-plan/plan-line";

/**
 * Carry over: the day's unfinished plan lines move to the next day, details and all.
 *
 * "Unfinished" = a task planned for the closed day that is not completed. Moving the row (not copying it) keeps one
 * task, one history, and means nothing is duplicated if the person carries twice. What a new day resets:
 *   - star / crown / manual order: tomorrow's priorities are chosen again, tonight;
 *   - the running timer and its banked time: a new day starts the clock fresh;
 *   - the Kill List pairing: the old row belongs to the old day and stays there as the record. The returned line
 *     still says `addToKillList`, so Finish mirrors it into the NEW day's Kill List like any other Business line;
 *   - a School line's due date, which the plan set to the plan day, moves with it.
 * Domain, Work tab, start time, timer length and criteria are kept as they were.
 */

type PlanRow = Parameters<typeof toPlanLineState>[0];

export async function getUnfinishedPlanLines(supabase: SupabaseClient, userId: string, day: string): Promise<PlanLineState[]> {
  const { data, error } = await supabase.from("tasks").select(PLAN_LINE_COLUMNS).eq("user_id", userId).eq("planned_date", day).eq("completed", false).order("created_at", { ascending: true });
  if (error) throw error;
  return sortPlanRows((data ?? []) as PlanRow[]).map(toPlanLineState);
}

export async function carryOverCore(
  supabase: SupabaseClient,
  userId: string,
  fromDay: string,
  toDay: string,
  ids: readonly string[],
): Promise<{ lines: PlanLineState[] } | { error: string }> {
  if (ids.length === 0) return { lines: [] };
  const { data, error } = await supabase
    .from("tasks")
    .select(`${PLAN_LINE_COLUMNS}, due_date`)
    .eq("user_id", userId)
    .eq("planned_date", fromDay)
    .eq("completed", false)
    .in("id", ids as string[]);
  if (error) return { error: error.message };
  const rows = data ?? [];
  if (rows.length === 0) return { lines: [] };

  const moveIds = rows.map((r) => r.id as string);
  const { error: moveError } = await supabase
    .from("tasks")
    .update({ planned_date: toDay, mit_rank: null, plan_order: null, kill_list_item_id: null, timer_started_at: null, timer_elapsed_seconds: 0 })
    .in("id", moveIds)
    .eq("user_id", userId)
    .eq("planned_date", fromDay)
    .eq("completed", false);
  if (moveError) return { error: moveError.message };

  const schoolIds = rows.filter((r) => r.plan_area === "school" && r.due_date === fromDay).map((r) => r.id as string);
  if (schoolIds.length > 0) {
    const { error: dueError } = await supabase.from("tasks").update({ due_date: toDay }).in("id", schoolIds).eq("user_id", userId);
    if (dueError) return { error: dueError.message };
  }

  const lines = rows.map((r) => ({ ...toPlanLineState(r as Parameters<typeof toPlanLineState>[0]), starred: false, crowned: false, order: null }));
  return { lines };
}
