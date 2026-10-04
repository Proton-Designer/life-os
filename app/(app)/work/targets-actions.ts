"use server";

import { revalidateWorkScreens } from "@/lib/work/revalidate-screens";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  addTargetCore,
  addStretchGoalCore,
  editTargetCore,
  completeTargetCore,
  moveTargetCore,
} from "@/lib/coop/targets-core";

function revalidateCoop(): void {
  revalidateWorkScreens();
  revalidatePath("/");
}

/** THIN WRAPPER over addTargetCore (lib/coop/targets-core.ts, L6/R5) — same core the MCP write tool calls. Requires a deadline per spec — "Adding a target REQUIRES a deadline." Inserts at the next open target slot (1-3); callers must have already checked fewer than 3 targets exist. */
export async function addTarget(title: string, deadline: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addTargetCore(supabase, userId, title, deadline);
  revalidateCoop();
}

/** THIN WRAPPER over addStretchGoalCore — never requires a deadline (spec: "Stretch goals do NOT require one"). Appended after every existing row, target or stretch. */
export async function addStretchGoal(title: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  await addStretchGoalCore(supabase, userId, title);
  revalidateCoop();
}

/** THIN WRAPPER over editTargetCore — "Full CRUD... edit content": title and/or deadline. Also the write path for the reused Set-a-deadline dialog (deadline only). */
export async function editTarget(id: string, fields: { title?: string; deadline?: string | null }): Promise<void> {
  const { supabase, userId } = await requireUser();
  await editTargetCore(supabase, userId, id, fields);
  revalidateCoop();
}

/**
 * NOT extracted to a shared core — a real DELETE (deletion refuses
 * server-side, migration 032, for a completed target, but still deletes an
 * active one), which the MCP write path may never do (L6's guardrail). No
 * second caller to share logic with, so this stays exactly as it was.
 */
export async function removeTarget(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_coop_target", { p_target_id: id });
  if (error) throw error;
  revalidateCoop();
}

/**
 * THIN WRAPPER over completeTargetCore. Marks a target done and lets the
 * cascade RPC shift everything below it up by one. Returns which row (if
 * any) now occupies the vacated slot and whether it needs a deadline —
 * spec: "the app prompts for one immediately" on promotion, never
 * inventing one. `null` promotedTargetId means either nothing existed
 * below the completed slot (target 3 completed with no stretch goal to
 * promote — ruling 6, reads as inviting, not broken) or the completed row
 * had already left the active queue (idempotent no-op path).
 */
export async function completeTarget(id: string): Promise<{ promotedTargetId: string | null; promotedNeedsDeadline: boolean }> {
  const { supabase, userId } = await requireUser();
  const result = await completeTargetCore(supabase, userId, id);
  revalidateCoop();
  return result;
}

/** THIN WRAPPER over moveTargetCore. Buttons, not drag (Opus Lead ruling — touch-conflict with horizontal snap-scroll). Moves exactly one step; the client computes the target position via lib/coop/targets.ts's moveTargetPosition and passes it straight through. */
export async function moveTarget(id: string, newPosition: number): Promise<void> {
  const { supabase, userId } = await requireUser();
  await moveTargetCore(supabase, userId, id, newPosition);
  revalidateCoop();
}
