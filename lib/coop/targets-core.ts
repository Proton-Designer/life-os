import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStretchPosition, nextTargetPosition, splitTargetsAndStretch, type CoopTargetRow } from "./targets";
import { requireRowUpdated } from "@/lib/mcp/require-row-updated";

/**
 * R5's core(supabase, userId, ...) extraction for the Work Targets strip —
 * same discipline as lib/deen/actions-core.ts. None of these call
 * requireUser()/getProfile()/getAuthedUser(); app/(app)/work/targets-actions.ts's
 * cookie-authed Server Actions and lib/mcp/write-registry.ts's bearer-authed
 * MCP handlers both call through these.
 *
 * `removeTarget` (RPC `delete_coop_target`) is DELIBERATELY NOT extracted
 * here — it is a real DELETE (guarded server-side against a completed
 * target, but still a delete for an active one), and the MCP write path
 * may never hard-delete a row (L6's guardrail). It stays exactly where it
 * was, cookie-coupled, in targets-actions.ts — there is no second caller
 * for it to share logic with.
 */

export async function getActiveTargetQueueCore(supabase: SupabaseClient, userId: string): Promise<CoopTargetRow[]> {
  const { data } = await supabase
    .from("coop_targets")
    .select("id, title, deadline, position")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("position", "is", null);
  return (data ?? []) as CoopTargetRow[];
}

/** Returns the new row's id, or `null` on the blank-title no-op — never invented, since MCP's write contract ({id, updated_at}) needs a real id when one was actually created. */
export async function addTargetCore(supabase: SupabaseClient, userId: string, title: string, deadline: string): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (!deadline) throw new Error("A target requires a deadline");
  const queue = await getActiveTargetQueueCore(supabase, userId);
  const { targets } = splitTargetsAndStretch(queue);
  const { data, error } = await supabase
    .from("coop_targets")
    .insert({ user_id: userId, title: trimmed, deadline, position: nextTargetPosition(targets) })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Returns the new row's id, or `null` on the blank-title no-op. */
export async function addStretchGoalCore(supabase: SupabaseClient, userId: string, title: string): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const queue = await getActiveTargetQueueCore(supabase, userId);
  const { data, error } = await supabase
    .from("coop_targets")
    .insert({ user_id: userId, title: trimmed, deadline: null, position: nextStretchPosition(queue) })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * P4-34: a bad, stale, or cross-tenant `id` now throws a clean not-found
 * (via the shared requireRowUpdated helper) instead of silently matching
 * zero rows and reporting success — see that helper's own header for the
 * enumeration-safety property this preserves. Only reaches the DB write at
 * all once `patch` is non-empty; the blank-title and nothing-given no-ops
 * above stay exactly as they were (never a reason to reject a real id).
 */
export async function editTargetCore(
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
  await requireRowUpdated(supabase, "coop_targets", patch, id, userId, `No target found with id "${id}".`);
}

export interface CompleteTargetResult {
  promotedTargetId: string | null;
  promotedNeedsDeadline: boolean;
}

export async function completeTargetCore(supabase: SupabaseClient, userId: string, id: string): Promise<CompleteTargetResult> {
  const { data: before } = await supabase.from("coop_targets").select("position").eq("id", id).eq("user_id", userId).maybeSingle();
  const vacatedPosition = before?.position ?? null;

  const { error } = await supabase.rpc("complete_target", { p_target_id: id });
  if (error) throw error;

  if (vacatedPosition === null) return { promotedTargetId: null, promotedNeedsDeadline: false };

  const { data: promoted } = await supabase.from("coop_targets").select("id, deadline").eq("user_id", userId).eq("position", vacatedPosition).maybeSingle();
  if (!promoted) return { promotedTargetId: null, promotedNeedsDeadline: false };
  return { promotedTargetId: promoted.id, promotedNeedsDeadline: promoted.deadline === null };
}

/**
 * RPC-backed reorder — `reorder_coop_target` is what actually persists a
 * new position, including cascading the displaced rows between the old and
 * new slot. This IS the "in diff order optionally" mechanism (team-lead)
 * for the `target` entity. No separate ownership pre-check here (matching
 * the original `moveTarget` exactly) — verified in migration 028 that the
 * RPC itself is already tenant-safe: it derives `v_user_id := auth.uid()`
 * internally and scopes every query by it, raising if the target isn't
 * found/owned, so it's correct under the MCP path's minted-JWT client for
 * the same reason it's correct under the cookie-authed one — both produce
 * a real `auth.uid()`.
 */
export async function moveTargetCore(supabase: SupabaseClient, userId: string, id: string, newPosition: number): Promise<void> {
  void userId; // not needed by this call — the RPC derives identity from auth.uid() itself; kept as a parameter for signature consistency with every other core function here.
  const { error } = await supabase.rpc("reorder_coop_target", { p_target_id: id, p_new_position: newPosition });
  if (error) throw error;
}
