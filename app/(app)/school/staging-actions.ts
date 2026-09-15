"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  confirmStagingBatchCore,
  updateStagedDeliverableCore,
  deleteStagedDeliverableCore,
  type ConfirmStagingBatchResult,
  type UpdateStagedDeliverableInput,
} from "@/lib/school/staging-core";
import type { AssessmentType } from "@/lib/school/actions-core";

export type { ConfirmStagingBatchResult };

/**
 * Phase 1 #18 — the confirm action, cookie-coupled server action wrapper around
 * `confirmStagingBatchCore`. Safe to call more than once on the same batch (a genuine
 * retry after a crash, a double-tap, or a user re-clicking "Confirm" after seeing some
 * rows still blocked on a missing date) — see that function's own header for the
 * resumability/race-safety this relies on.
 *
 * Reachable from the UI as of #16's review panel (syllabus-review-panel.tsx) — #16
 * is the only thing that can ever create a `staging_batches` row to confirm.
 */
export async function confirmStagingBatch(batchId: string): Promise<ConfirmStagingBatchResult> {
  const { supabase, userId } = await requireUser();
  const result = await confirmStagingBatchCore(supabase, userId, batchId);
  revalidatePath("/school");
  return result;
}

/** Phase 1 #16 — corrects a staged item's name/type/date before confirm (e.g. an
 * invalid model type remapped to homework_assignment with confidence zeroed, or a
 * null date the model couldn't resolve). */
export async function updateStagedDeliverable(
  deliverableId: string,
  input: { name: string; type: AssessmentType; date: string | null }
) {
  const { supabase, userId } = await requireUser();
  const coreInput: UpdateStagedDeliverableInput = input;
  await updateStagedDeliverableCore(supabase, userId, deliverableId, coreInput);
  revalidatePath("/school");
}

/** Phase 1 #16 — rejects a staged item (a plain delete; see deleteStagedDeliverableCore's
 * own header for why there's no separate accept/reject column). */
export async function deleteStagedDeliverable(deliverableId: string) {
  const { supabase, userId } = await requireUser();
  await deleteStagedDeliverableCore(supabase, userId, deliverableId);
  revalidatePath("/school");
}
