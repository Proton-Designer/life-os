import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Business plan line "Added to Kill List" is ONE decision in two rows: the plan task (tasks.kill_list_item_id)
 * and its Kill List slot. Either can be completed from where the person happens to be -- Home's plan list, the
 * Business page, a Lock-In session's objective checklist -- so every completion path calls one of these to carry
 * the same state to the other row. Both are cheap no-ops (one UPDATE matching zero rows) for the common unpaired case.
 */

/** A kill-list item was completed/reopened: carry it to the plan task paired with it, if any. */
export async function syncPlanTaskFromKillList(supabase: SupabaseClient, userId: string, killListItemId: string, completed: boolean, completedAt: string | null): Promise<void> {
  const { error } = await supabase.from("tasks").update({ completed, completed_at: completedAt }).eq("user_id", userId).eq("kill_list_item_id", killListItemId);
  if (error) throw error;
}

/** A task was completed/reopened: carry it to its paired kill-list item. The caller already read `kill_list_item_id` in its own query, so an unpaired task costs nothing here. */
export async function syncKillListFromTask(supabase: SupabaseClient, userId: string, killListItemId: string | null | undefined, completed: boolean, completedAt: string | null): Promise<void> {
  if (!killListItemId) return;
  const { error } = await supabase.from("kill_list_items").update({ completed, completed_at: completedAt }).eq("id", killListItemId).eq("user_id", userId);
  if (error) throw error;
}
