"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { confirmStagingBatchCore, type ConfirmStagingBatchResult } from "@/lib/school/staging-core";

export type { ConfirmStagingBatchResult };

/**
 * Phase 1 #18 — the confirm action, cookie-coupled server action wrapper around
 * `confirmStagingBatchCore`. Safe to call more than once on the same batch (a genuine
 * retry after a crash, a double-tap, or a user re-clicking "Confirm" after seeing some
 * rows still blocked on a missing date) — see that function's own header for the
 * resumability/race-safety this relies on.
 *
 * NOT YET REACHABLE FROM THE UI — #16 (syllabus upload → AI extraction → staged rows)
 * is the only thing that can ever create a `staging_batches` row to confirm, and #16
 * hasn't been built yet. This action exists and is fully tested (staging-core.test.ts:
 * happy path, no-date partial commit, zero-child success state, resume after a crash,
 * true concurrent double-tap) ahead of #16 per the build order, but it has no caller in
 * production until #16 ships a "Confirm" button that calls it. Saying so explicitly
 * rather than rounding this up to "done."
 */
export async function confirmStagingBatch(batchId: string): Promise<ConfirmStagingBatchResult> {
  const { supabase, userId } = await requireUser();
  const result = await confirmStagingBatchCore(supabase, userId, batchId);
  revalidatePath("/school");
  return result;
}
