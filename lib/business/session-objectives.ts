import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionObjective = {
  id: string;
  kind: "kill_list_item" | "task" | "custom";
  label: string;
  /** DERIVED, not stored, for kind='kill_list_item'/'task' — read from the
   * live kill_list_items/tasks row, never from this table's own `completed`
   * column (see toggleSessionObjectiveCore's header for why a mirror was
   * rejected). Only for kind='custom' is this the table's own column. */
  completed: boolean;
  /** kill_list_item_id or task_id — null for kind='custom'. */
  refId: string | null;
};

/**
 * One session's objectives, ordered by selection position, with
 * kill_list_item/task labels and completion joined from the live rows
 * (application-level join over two `.in("id", …)` queries, not a PostgREST
 * nested embed — this repo's composite FKs are new enough, and the stakes
 * of a silently-empty embed high enough for an overlay's auto-end logic,
 * that an explicit join whose correctness is fully inspectable here beat a
 * clever one I could not verify against a live database in this session).
 */
export async function loadSessionObjectivesCore(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionObjective[]> {
  const { data: rows, error } = await supabase
    .from("work_session_objectives")
    .select("id, kind, custom_text, completed, kill_list_item_id, task_id")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const killListIds = rows.filter((r) => r.kind === "kill_list_item" && r.kill_list_item_id).map((r) => r.kill_list_item_id as string);
  const taskIds = rows.filter((r) => r.kind === "task" && r.task_id).map((r) => r.task_id as string);

  const [killListResult, taskResult] = await Promise.all([
    killListIds.length > 0
      ? supabase.from("kill_list_items").select("id, text, completed").eq("user_id", userId).in("id", killListIds)
      : Promise.resolve({ data: [] as { id: string; text: string; completed: boolean }[], error: null }),
    taskIds.length > 0
      ? supabase.from("tasks").select("id, title, completed").eq("user_id", userId).in("id", taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string; completed: boolean }[], error: null }),
  ]);
  if (killListResult.error) throw killListResult.error;
  if (taskResult.error) throw taskResult.error;

  const killListById = new Map((killListResult.data ?? []).map((r) => [r.id, r]));
  const taskById = new Map((taskResult.data ?? []).map((r) => [r.id, r]));

  return rows.map((row): SessionObjective => {
    if (row.kind === "custom") {
      return { id: row.id, kind: "custom", label: row.custom_text ?? "", completed: row.completed, refId: null };
    }
    if (row.kind === "kill_list_item") {
      const item = row.kill_list_item_id ? killListById.get(row.kill_list_item_id) : undefined;
      // A missing join row means the kill list item was deleted (CASCADE,
      // 146) after this session read stale-but-not-yet-reconciled data, or
      // (should be unreachable given CASCADE) simply doesn't exist. Either
      // way, absent is treated as absent — not silently completed=true,
      // which would be the "absent read as a value" bug class AGENTS.md
      // warns about, applied to a boolean this time instead of a date.
      return { id: row.id, kind: "kill_list_item", label: item?.text ?? "", completed: item?.completed ?? false, refId: row.kill_list_item_id };
    }
    const task = row.task_id ? taskById.get(row.task_id) : undefined;
    return { id: row.id, kind: "task", label: task?.title ?? "", completed: task?.completed ?? false, refId: row.task_id };
  });
}
