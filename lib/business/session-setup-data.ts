import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString } from "@/lib/date-utils";

/** How far ahead a Deep Study session's class picker looks for candidate tasks — Ayman's "due in the next 14 days". */
export const CLASS_TASKS_WINDOW_DAYS = 14;

export type ObjectiveTaskOption = { id: string; title: string; dueDate: string };

/**
 * Open (uncompleted) tasks for one class, due `todayStr` through
 * `todayStr + CLASS_TASKS_WINDOW_DAYS` inclusive — the setup dialog's Deep
 * Study objective candidates (146/session-setup-dialog.tsx). `todayStr` is
 * always the caller's already-resolved local date (AGENTS.md: never derive
 * a calendar date from a raw `Date` inside this function) — the thin
 * "use server" wrapper (app/(app)/business/actions.ts) computes it via
 * `localDateString` before calling in.
 *
 * Completed tasks are excluded outright, not merely de-emphasised — Ayman's
 * rule ("offers only incomplete items") applies to both objective kinds,
 * kill-list and task alike; a session that could start already-satisfied
 * because a finished task was pre-selected would auto-end on its first
 * render (Opus Lead review, 2026-09-10).
 */
export async function getClassTasksDueSoonCore(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  todayStr: string
): Promise<ObjectiveTaskOption[]> {
  const horizonStr = addDaysToDateString(todayStr, CLASS_TASKS_WINDOW_DAYS);
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, due_date")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .eq("completed", false)
    .not("due_date", "is", null)
    .gte("due_date", todayStr)
    .lte("due_date", horizonStr)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date as string }));
}
