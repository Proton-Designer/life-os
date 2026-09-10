import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString } from "@/lib/date-utils";
import type { KillListSlotData } from "@/components/business/kill-list";

export type KillListObjectiveOption = { id: string; text: string };

export type SessionClassOption = { id: string; label: string };

/** One objective as the setup dialog (components/business/session-setup-dialog.tsx)
 * collects it — `id` for kill_list_item/task refers to that row's id; the
 * provider (lock-in-overlay-context.tsx) maps this to actions-core.ts's
 * StartSessionObjectiveInput (killListItemId/taskId, not a shared `id`
 * field) before calling startWorkSession. Two different shapes on purpose:
 * this one is what a UI selection naturally is (an id plus which list it
 * came from); that one is what the DB row needs (a specific named column
 * per kind, matching work_session_objectives' own CHECK). */
export type ObjectiveSelection =
  | { kind: "kill_list_item"; id: string }
  | { kind: "task"; id: string }
  | { kind: "custom"; text: string };

export type SessionStartPayload = {
  goalMinutes: number;
  classId: string | null;
  objectives: ObjectiveSelection[];
};

/**
 * Today's kill list, narrowed to the setup dialog's Deep Work objective
 * candidates — filled slots only (an empty slot has `id: null`), incomplete
 * only (Ayman: "offers only incomplete items" — an already-done item picked
 * here would let a session start already satisfied and auto-end on its
 * first render, Opus Lead review 2026-09-10). A pure transform of
 * already-fetched slots, not its own query: `getKillListSlots`
 * (lib/business/kill-list-slots.ts) is already `cache()`'d and deliberately
 * NOT fetched unconditionally on every page load (app-shell.tsx's own
 * comment: gated to the one navigation shape that already needs it, an
 * active Deep Work session) — the setup dialog needs it at a DIFFERENT
 * moment (before a session exists), so it is fetched on-demand when the
 * dialog opens (getSessionKillListObjectives, app/(app)/business/actions.ts),
 * not threaded down from the shell unconditionally, which would reintroduce
 * the exact round trip that comment exists to avoid.
 */
export function toKillListObjectiveOptions(slots: readonly KillListSlotData[]): KillListObjectiveOption[] {
  return slots
    .filter((s): s is KillListSlotData & { id: string } => s.id !== null && !s.completed)
    .map((s) => ({ id: s.id, text: s.text }));
}

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
/**
 * The Deep Study setup dialog's class picker candidates. A plain, cheap
 * query, but still fetched on-demand from inside the dialog
 * (getSessionClasses, app/(app)/business/actions.ts) rather than threaded
 * down from app-shell.tsx — same reasoning as
 * toKillListObjectiveOptions's own comment: the shell's data-fetching is
 * deliberately minimal on every navigation, and this is needed at a moment
 * (setup, before a session exists) the shell doesn't already touch.
 */
export async function getUserClassesCore(supabase: SupabaseClient, userId: string): Promise<SessionClassOption[]> {
  const { data, error } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId).order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, label: c.short_name ?? c.code }));
}

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
