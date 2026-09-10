import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStage, previousStage, type CoopTaskStatus } from "./tasks";

/**
 * R5 core(supabase, userId, ...) extraction for the Work pipeline's
 * `coop_tasks` — same discipline as lib/deen/actions-core.ts and
 * lib/coop/targets-core.ts. `removeTaskCore`/`bulkRemoveTasksCore` are
 * DELIBERATELY NOT extracted — both are real DELETEs (no completion-history
 * guard at all, per the original file's own comment), and the MCP write
 * path may never hard-delete a row (L6's guardrail). They stay exactly
 * where they were, cookie-coupled, in tasks-actions.ts.
 */

/** Returns the new row's id, or `null` on the blank-title no-op — never invented, since MCP's write contract ({id, updated_at}) needs a real id when one was actually created. */
export async function addAgendaTaskCore(supabase: SupabaseClient, targetId: string, title: string, deadline?: string): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("coop_tasks")
    .insert({ target_id: targetId, title: trimmed, deadline: deadline ?? null, status: "backlog" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function editTaskCore(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  fields: { title?: string; deadline?: string | null },
): Promise<void> {
  const patch: { title?: string; deadline?: string | null } = {};
  if (fields.title !== undefined) {
    const trimmed = fields.title.trim();
    if (!trimmed) return;
    patch.title = trimmed;
  }
  if (fields.deadline !== undefined) patch.deadline = fields.deadline;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("coop_tasks").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/** completed_at (migration 055) tracks the Past section's 7-day clock — set the instant a task lands on "complete", cleared the instant it leaves, from every path that changes status. */
async function setStatusCore(supabase: SupabaseClient, userId: string, id: string, status: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status, completed_at: status === "complete" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function returnTaskToReviewCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  await setStatusCore(supabase, userId, id, "review");
}

export async function advanceTaskCore(supabase: SupabaseClient, userId: string, id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const next = nextStage(currentStatus);
  if (!next) return;
  await setStatusCore(supabase, userId, id, next);
}

export async function retreatTaskCore(supabase: SupabaseClient, userId: string, id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const prev = previousStage(currentStatus);
  if (!prev) return;
  await setStatusCore(supabase, userId, id, prev);
}

/** `reason` is optional and trimmed; a blank or omitted reason is stored as NULL, never `''` — "absent read as a value" is the bug class this repo pays most for. */
export async function blockTaskCore(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  currentStatus: Exclude<CoopTaskStatus, "blocked">,
  reason?: string,
): Promise<void> {
  const trimmedReason = reason?.trim();
  const { error } = await supabase
    .from("coop_tasks")
    .update({
      status: "blocked",
      blocked_from: currentStatus,
      blocked_reason: trimmedReason ? trimmedReason : null,
      blocked_since: new Date().toISOString(),
      completed_at: null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function unblockTaskCore(supabase: SupabaseClient, userId: string, id: string, blockedFrom: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { error } = await supabase
    .from("coop_tasks")
    .update({
      status: blockedFrom,
      blocked_from: null,
      blocked_reason: null,
      blocked_since: null,
      completed_at: blockedFrom === "complete" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}
