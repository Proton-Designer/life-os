import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Inbox (IA-P1a): what the "+" sheet parks without an area — a Note, or a Task with
 * "No area". NO new table or column: an Inbox row is a `tasks` row with `domain IS NULL`,
 * `dump_source = 'capture'` and `completed = false`. Every triage action below moves a row
 * OUT of that shape, so a triaged item can never reappear:
 *   plan   -> dump_source 'note' + planned_date (the evening close's own dump line)
 *   task   -> domain school / co_op (a real task; planned_date cleared)
 *   worry  -> dump_source 'worry' (the worries list / Monday hour find it by kind)
 *   done   -> completed = true (archive; never a DELETE)
 * Each update re-asserts the Inbox shape in its WHERE and verifies a row changed, so a stale
 * tap (already triaged in another tab) reports an error instead of silently doing nothing.
 */

export type InboxItem = { id: string; title: string; dueDate: string | null };

export type InboxTriage =
  | { kind: "plan"; plannedDate: string }
  | { kind: "task"; area: "school" | "co_op" }
  | { kind: "worry" }
  | { kind: "done" };

export type InboxCoreResult = { ok: true } | { ok: false; error: string };

const INBOX_LIMIT = 50;

export async function getInboxItems(supabase: SupabaseClient, userId: string): Promise<InboxItem[]> {
  const { data } = await supabase
    .from("tasks")
    .select("id, title, due_date")
    .eq("user_id", userId)
    .is("domain", null)
    .eq("dump_source", "capture")
    .eq("completed", false)
    .order("created_at", { ascending: true })
    .limit(INBOX_LIMIT);
  return (data ?? []).map((r) => ({ id: r.id as string, title: r.title as string, dueDate: (r.due_date as string | null) ?? null }));
}

export async function triageInboxCore(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  triage: InboxTriage,
  now: Date = new Date()
): Promise<InboxCoreResult> {
  let patch: Record<string, unknown>;
  switch (triage.kind) {
    case "plan":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(triage.plannedDate)) return { ok: false, error: "Bad plan date" };
      patch = { dump_source: "note", planned_date: triage.plannedDate };
      break;
    case "task":
      if (triage.area !== "school" && triage.area !== "co_op") return { ok: false, error: "Pick an area" };
      patch = { domain: triage.area, planned_date: null };
      break;
    case "worry":
      patch = { dump_source: "worry" };
      break;
    case "done":
      patch = { completed: true, completed_at: now.toISOString() };
      break;
    default:
      return { ok: false, error: "Unknown triage action" };
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .is("domain", null)
    .eq("dump_source", "capture")
    .eq("completed", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "That item was already sorted." };
  return { ok: true };
}
