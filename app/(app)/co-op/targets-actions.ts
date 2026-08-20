"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { nextStretchPosition, nextTargetPosition, splitTargetsAndStretch, type CoopTargetRow } from "@/lib/coop/targets";

function revalidateCoop(): void {
  revalidatePath("/co-op");
  revalidatePath("/");
}

async function getActiveQueue(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string): Promise<CoopTargetRow[]> {
  const { data } = await supabase
    .from("coop_targets")
    .select("id, title, deadline, position")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("position", "is", null);
  return (data ?? []) as CoopTargetRow[];
}

/** Requires a deadline per spec — "Adding a target REQUIRES a deadline." Inserts at the next open target slot (1-3); callers must have already checked fewer than 3 targets exist. */
export async function addTarget(title: string, deadline: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  if (!deadline) throw new Error("A target requires a deadline");
  const { supabase, userId } = await requireUser();
  const queue = await getActiveQueue(supabase, userId);
  const { targets } = splitTargetsAndStretch(queue);
  const { error } = await supabase
    .from("coop_targets")
    .insert({ title: trimmed, deadline, position: nextTargetPosition(targets) });
  if (error) throw error;
  revalidateCoop();
}

/** Never requires a deadline — spec: "Stretch goals do NOT require one." Appended after every existing row, target or stretch. */
export async function addStretchGoal(title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const { supabase, userId } = await requireUser();
  const queue = await getActiveQueue(supabase, userId);
  const { error } = await supabase
    .from("coop_targets")
    .insert({ title: trimmed, deadline: null, position: nextStretchPosition(queue) });
  if (error) throw error;
  revalidateCoop();
}

/** "Full CRUD... edit content" — title and/or deadline. Also the write path for the reused Set-a-deadline dialog (deadline only). */
export async function editTarget(id: string, fields: { title?: string; deadline?: string | null }): Promise<void> {
  const { supabase, userId } = await requireUser();
  const patch: { title?: string; deadline?: string | null } = {};
  if (fields.title !== undefined) {
    const trimmed = fields.title.trim();
    if (!trimmed) return;
    patch.title = trimmed;
  }
  if (fields.deadline !== undefined) patch.deadline = fields.deadline;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("coop_targets").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Deletion refuses server-side (032) for a completed target — the UI must never offer this action there, but the RPC is the backstop either way. */
export async function removeTarget(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_coop_target", { p_target_id: id });
  if (error) throw error;
  revalidateCoop();
}

/**
 * Marks a target done and lets the cascade RPC shift everything below it
 * up by one. Returns which row (if any) now occupies the vacated slot and
 * whether it needs a deadline — spec: "the app prompts for one
 * immediately" on promotion, never inventing one. `null` promotedTargetId
 * means either nothing existed below the completed slot (target 3
 * completed with no stretch goal to promote — ruling 6, reads as
 * inviting, not broken) or the completed row had already left the active
 * queue (idempotent no-op path).
 */
export async function completeTarget(id: string): Promise<{ promotedTargetId: string | null; promotedNeedsDeadline: boolean }> {
  const { supabase, userId } = await requireUser();
  const { data: before } = await supabase
    .from("coop_targets")
    .select("position")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  const vacatedPosition = before?.position ?? null;

  const { error } = await supabase.rpc("complete_target", { p_target_id: id });
  if (error) throw error;
  revalidateCoop();

  if (vacatedPosition === null) return { promotedTargetId: null, promotedNeedsDeadline: false };

  const { data: promoted } = await supabase
    .from("coop_targets")
    .select("id, deadline")
    .eq("user_id", userId)
    .eq("position", vacatedPosition)
    .maybeSingle();
  if (!promoted) return { promotedTargetId: null, promotedNeedsDeadline: false };
  return { promotedTargetId: promoted.id, promotedNeedsDeadline: promoted.deadline === null };
}

/** Buttons, not drag (Opus Lead ruling — touch-conflict with horizontal snap-scroll). Moves exactly one step; the client computes the target position via lib/coop/targets.ts's moveTargetPosition and passes it straight through. */
export async function moveTarget(id: string, newPosition: number): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("reorder_coop_target", { p_target_id: id, p_new_position: newPosition });
  if (error) throw error;
  revalidateCoop();
}
