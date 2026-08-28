"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { nextStage, previousStage, type CoopTaskStatus } from "@/lib/coop/tasks";

function revalidateCoop(): void {
  revalidatePath("/work");
  revalidatePath("/");
}

/** Every new task is automatically placed in Backlog (spec) — the status column simply defaults there, no separate write path. */
export async function addAgendaTask(targetId: string, title: string, deadline?: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .insert({ target_id: targetId, title: trimmed, deadline: deadline ?? null, status: "backlog" });
  if (error) throw error;
  revalidateCoop();
}

export async function editTask(id: string, fields: { title?: string; deadline?: string | null }): Promise<void> {
  const { supabase, userId } = await requireUser();
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
  revalidateCoop();
}

/** completed_at (migration 055) tracks the Past section's 7-day clock — it is set
 * the instant a task lands on "complete" and cleared the instant it leaves, from
 * every path that changes status (this function, blockTask, unblockTask). */
async function setStatus(id: string, status: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status, completed_at: status === "complete" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Past-dialog action: pulls a completed task back into the active pipeline without deleting it. */
export async function returnTaskToReview(id: string): Promise<void> {
  await setStatus(id, "review");
}

/** Buttons, not drag (standing app convention — see the Targets strip's move buttons). Advances one stage forward; a no-op past Complete since there's nothing further. */
export async function advanceTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const next = nextStage(currentStatus);
  if (!next) return;
  await setStatus(id, next);
}

/** Moves one stage back; a no-op before Backlog. */
export async function retreatTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const prev = previousStage(currentStatus);
  if (!prev) return;
  await setStatus(id, prev);
}

/** Ruling 2: blocked is a detached pause, not a stage. Captures the current status as blockedFrom so unblocking never has to guess. Clears completed_at — a task paused mid-flight isn't "complete" for Past-section purposes even if it was blocked away from that column. */
export async function blockTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status: "blocked", blocked_from: currentStatus, completed_at: null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Restores the task to whatever it was doing before it was blocked, then clears blocked_from — 028's CHECK constraint requires blocked_from to be null whenever status isn't 'blocked', so both must change together in one update. Restarts the completed_at clock if it's landing back on "complete" (it wasn't complete while blocked, so the 7-day window fairly starts now). */
export async function unblockTask(id: string, blockedFrom: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status: blockedFrom, blocked_from: null, completed_at: blockedFrom === "complete" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Plain delete — unlike a target, a task carries no completion-history requirement (ruling 5 is about targets), so there's no refuse-on-complete guard here. */
export async function removeTask(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("coop_tasks").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Past dialog's bulk-delete — one round trip for the whole selection, scoped to this user like every other mutation here. */
export async function bulkRemoveTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("coop_tasks").delete().in("id", ids).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}
