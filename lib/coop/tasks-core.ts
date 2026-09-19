import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStage, previousStage, type CoopTaskStatus } from "./tasks";
import { requireRowUpdated } from "@/lib/mcp/require-row-updated";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

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

/** P4-34: a bad, stale, or cross-tenant `id` now throws a clean not-found (via the shared requireRowUpdated helper) instead of silently matching zero rows and reporting success. Same posture as lib/coop/targets-core.ts's editTargetCore. */
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
  await requireRowUpdated(supabase, "coop_tasks", patch, id, userId, `No task found with id "${id}".`);
}

/**
 * completed_at (migration 055) tracks the Past section's 7-day clock — set
 * the instant a task lands on "complete", cleared the instant it leaves,
 * from every path that changes status.
 *
 * IDEMPOTENCY (AI Integration program, MCP `work.task.advance`/`.unblock` —
 * see lib/mcp/write-registry.ts): `completed_at` answers "when was this
 * completed", not "when did something last call advance/unblock". A retry
 * that lands on the SAME already-current status must not re-stamp it —
 * that's not merely non-idempotent, it corrupts completion history (a task
 * genuinely completed at 9am reads as completed at the retry's time
 * instead). Reads the row's current state first: only stamps a fresh
 * `completed_at` when actually transitioning INTO "complete" from something
 * else; a call that finds the row already at the target status preserves
 * whatever `completed_at` is already there.
 */
async function setStatusCore(supabase: SupabaseClient, userId: string, id: string, status: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { data: current } = await supabase.from("coop_tasks").select("status, completed_at").eq("id", id).eq("user_id", userId).maybeSingle();
  // P4-34: this read is ALREADY scoped by id + user_id for the idempotency
  // check above -- it just never had its zero-row result checked, so a
  // bad/stale/cross-tenant id fell through with `current` undefined and the
  // UPDATE below silently matched zero rows while still reporting success.
  // No new query added: reusing this same read is what keeps a cross-tenant
  // id and a truly nonexistent id producing the identical thrown error.
  if (!current) throw new ToolNotFoundError(`No task found with id "${id}".`);
  const completedAt =
    status === "complete" ? (current?.status === "complete" ? current.completed_at : new Date().toISOString()) : null;
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status, completed_at: completedAt })
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

/**
 * `reason` is optional and trimmed; a blank or omitted reason is stored as NULL, never `''` — "absent read as a value" is the bug class this repo pays most for.
 *
 * IDEMPOTENCY (AI Integration program, MCP `work.task.block` — see
 * lib/mcp/write-registry.ts): `blocked_since` answers "when did this become
 * blocked", not "when was block last called". A retry against an
 * already-blocked row must preserve the original instant, or any "blocked
 * for N days" reading quietly resets on every retry. Reads the row's
 * current state first: only stamps a fresh `blocked_since` when actually
 * transitioning INTO "blocked"; a retry that finds the row already blocked
 * preserves the existing `blocked_since`.
 */
export async function blockTaskCore(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  currentStatus: Exclude<CoopTaskStatus, "blocked">,
  reason?: string,
): Promise<void> {
  const trimmedReason = reason?.trim();
  const { data: current } = await supabase.from("coop_tasks").select("status, blocked_since").eq("id", id).eq("user_id", userId).maybeSingle();
  // P4-34: same reuse-the-existing-read fix as setStatusCore above.
  if (!current) throw new ToolNotFoundError(`No task found with id "${id}".`);
  const blockedSince = current?.status === "blocked" && current.blocked_since ? current.blocked_since : new Date().toISOString();
  const { error } = await supabase
    .from("coop_tasks")
    .update({
      status: "blocked",
      blocked_from: currentStatus,
      blocked_reason: trimmedReason ? trimmedReason : null,
      blocked_since: blockedSince,
      completed_at: null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * IDEMPOTENCY (AI Integration program, MCP `work.task.unblock` — see
 * lib/mcp/write-registry.ts): same reasoning as `setStatusCore` above —
 * `completed_at` must not be re-stamped on a retry that finds the row
 * already restored to `blockedFrom`. Only stamps a fresh `completed_at`
 * when actually transitioning INTO "complete"; a retry that finds the row
 * already at `blockedFrom` (already unblocked) preserves the existing value.
 */
export async function unblockTaskCore(supabase: SupabaseClient, userId: string, id: string, blockedFrom: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { data: current } = await supabase.from("coop_tasks").select("status, completed_at").eq("id", id).eq("user_id", userId).maybeSingle();
  // P4-34: same reuse-the-existing-read fix as setStatusCore above.
  if (!current) throw new ToolNotFoundError(`No task found with id "${id}".`);
  const completedAt =
    blockedFrom === "complete" ? (current?.status === "complete" ? current.completed_at : new Date().toISOString()) : null;
  const { error } = await supabase
    .from("coop_tasks")
    .update({
      status: blockedFrom,
      blocked_from: null,
      blocked_reason: null,
      blocked_since: null,
      completed_at: completedAt,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}
