"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import type { CoopTaskStatus } from "@/lib/coop/tasks";
import {
  addAgendaTaskCore,
  editTaskCore,
  returnTaskToReviewCore,
  advanceTaskCore,
  retreatTaskCore,
  blockTaskCore,
  unblockTaskCore,
} from "@/lib/coop/tasks-core";

function revalidateCoop(): void {
  revalidatePath("/work");
  revalidatePath("/");
}

/** THIN WRAPPER over addAgendaTaskCore (lib/coop/tasks-core.ts, L6/R5) — same core the MCP write tool calls. Every new task is automatically placed in Backlog (spec) — the status column simply defaults there, no separate write path. */
export async function addAgendaTask(targetId: string, title: string, deadline?: string): Promise<void> {
  const { supabase } = await requireUser();
  await addAgendaTaskCore(supabase, targetId, title, deadline);
  revalidateCoop();
}

/** THIN WRAPPER over editTaskCore. */
export async function editTask(id: string, fields: { title?: string; deadline?: string | null }): Promise<void> {
  const { supabase, userId } = await requireUser();
  await editTaskCore(supabase, userId, id, fields);
  revalidateCoop();
}

/** THIN WRAPPER over returnTaskToReviewCore. Past-dialog action: pulls a completed task back into the active pipeline without deleting it. */
export async function returnTaskToReview(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await returnTaskToReviewCore(supabase, userId, id);
  revalidateCoop();
}

/** THIN WRAPPER over advanceTaskCore. Buttons, not drag (standing app convention — see the Targets strip's move buttons). Advances one stage forward; a no-op past Complete since there's nothing further. */
export async function advanceTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  await advanceTaskCore(supabase, userId, id, currentStatus);
  revalidateCoop();
}

/** THIN WRAPPER over retreatTaskCore. Moves one stage back; a no-op before Backlog. */
export async function retreatTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  await retreatTaskCore(supabase, userId, id, currentStatus);
  revalidateCoop();
}

/** THIN WRAPPER over blockTaskCore. Ruling 2: blocked is a detached pause, not a stage. Captures the current status as blockedFrom so unblocking never has to guess. */
export async function blockTask(id: string, currentStatus: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  await blockTaskCore(supabase, userId, id, currentStatus);
  revalidateCoop();
}

/** THIN WRAPPER over unblockTaskCore. Restores the task to whatever it was doing before it was blocked, then clears blocked_from. */
export async function unblockTask(id: string, blockedFrom: Exclude<CoopTaskStatus, "blocked">): Promise<void> {
  const { supabase, userId } = await requireUser();
  await unblockTaskCore(supabase, userId, id, blockedFrom);
  revalidateCoop();
}

/**
 * NOT extracted to a shared core — a plain DELETE (unlike a target, a task
 * carries no completion-history requirement, ruling 5 is about targets, so
 * there's no refuse-on-complete guard here). The MCP write path may never
 * hard-delete a row (L6's guardrail); no second caller to share logic with.
 */
export async function removeTask(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("coop_tasks").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}

/** Same as removeTask — a real DELETE, deliberately not extracted for MCP use. */
export async function bulkRemoveTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("coop_tasks").delete().in("id", ids).eq("user_id", userId);
  if (error) throw error;
  revalidateCoop();
}
