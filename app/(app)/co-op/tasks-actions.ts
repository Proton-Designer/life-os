"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { nextStage, previousStage, type CoopTaskStatus } from "@/lib/coop/tasks";

function revalidateCoop(): void {
  revalidatePath("/co-op");
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

async function setStatus(id: string, status: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("coop_tasks").update({ status }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
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

/** Ruling 2: blocked is a detached pause, not a stage. Captures the current status as blockedFrom so unblocking never has to guess. */
export async function blockTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status: "blocked", blocked_from: currentStatus })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Restores the task to whatever it was doing before it was blocked, then clears blocked_from — 028's CHECK constraint requires blocked_from to be null whenever status isn't 'blocked', so both must change together in one update. */
export async function unblockTask(id: string, blockedFrom: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("coop_tasks")
    .update({ status: blockedFrom, blocked_from: null })
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
