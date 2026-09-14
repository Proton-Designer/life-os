import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addClassAssessmentCore, type AssessmentType } from "@/lib/school/actions-core";

export type StagingBatchStatus = "pending" | "confirming" | "confirmed";

export interface UncommittedDeliverable {
  id: string;
  name: string;
  /** Why this row is still uncommitted — the confirm loop's own reason, not a guess:
   * "no_date" is #17's no-guessing rule surfacing at confirm time (a staged item with an
   * unresolved date cannot become a class_assessments row, which has a NOT NULL date
   * column — the user must fill it in or delete the row), "insert_failed" is anything
   * else the insert itself raised. */
  reason: "no_date" | "insert_failed";
  error?: string;
}

export interface ConfirmStagingBatchResult {
  status: StagingBatchStatus | null;
  committedCount: number;
  /** Rows still lacking a committed_assessment_id after this call — empty exactly when
   * `status === "confirmed"`. A non-empty list with status "confirming" is #17's own
   * "confirm blocked on these specific rows" state, not a failure of this function. */
  remaining: UncommittedDeliverable[];
}

/**
 * Phase 1 #18 — the confirm action, app side. Reuses `addClassAssessmentCore` (Ruling
 * R5's task-linked assessment creation) rather than reimplementing it against
 * `staged_deliverables` — two implementations of "create an assessment" is exactly the
 * kind of drift this program's own conventions exist to prevent.
 *
 * THE ATOMIC PART lives entirely in migration 167's two RPCs (`claim_staging_batch`,
 * `finalize_staging_batch`) — this function is deliberately NOT a single transaction
 * around them (PostgREST gives this program no such thing regardless, the same
 * limitation `addClassAssessmentCore` itself already lives with). What this function
 * guarantees instead: calling it twice, or calling it after a crash mid-way, converges
 * on the same correct result — every resolvable row committed, every row still missing a
 * date left alone and reported, and `finalize_staging_batch`'s own WHERE NOT EXISTS is
 * what actually decides whether the batch is allowed to read `confirmed`, not this
 * function's own bookkeeping.
 *
 * A staged row with a null `date` is SKIPPED, never errored on — inserting it into
 * `class_assessments` (whose `date` column is `NOT NULL`) cannot succeed, and that is
 * #17's no-guessing rule working exactly as intended: the row stays uncommitted, the
 * batch stays `confirming`, and the caller finds out which specific row is blocking full
 * confirm rather than the whole call failing opaquely.
 *
 * TRUE CONCURRENT DOUBLE-TAP, not just a retry after a crash: `claim_staging_batch`
 * intentionally lets a SECOND caller proceed against an already-`confirming` batch (that
 * is what makes a crash-then-retry resumable) — but that means two genuinely concurrent
 * calls can both read the SAME row as uncommitted and both create a `class_assessments`
 * row for it. The stamp step below is therefore itself a conditional UPDATE
 * (`committed_assessment_id IS NULL` in its WHERE clause, not just in the prior SELECT),
 * so only one caller's stamp actually lands; the loser detects zero rows affected, deletes
 * its own now-orphaned assessment (the same compensating-cleanup shape
 * `addClassAssessmentCore` already uses when its own two-statement create partially
 * fails), and does not double-count it. This is the row-level twin of the batch-level CAS
 * — same technique, one level down, closing the gap that CAS alone leaves open.
 */
export async function confirmStagingBatchCore(
  supabase: SupabaseClient,
  userId: string,
  batchId: string
): Promise<ConfirmStagingBatchResult> {
  const { data: claimStatus, error: claimError } = await supabase.rpc("claim_staging_batch", { p_batch_id: batchId });
  if (claimError) throw claimError;

  if (claimStatus == null) {
    return { status: null, committedCount: 0, remaining: [] };
  }
  if (claimStatus === "confirmed") {
    return { status: "confirmed", committedCount: 0, remaining: [] };
  }

  const { data: batch, error: batchError } = await supabase
    .from("staging_batches")
    .select("class_id")
    .eq("id", batchId)
    .eq("user_id", userId)
    .single();
  if (batchError) throw batchError;

  const { data: uncommitted, error: rowsError } = await supabase
    .from("staged_deliverables")
    .select("id, name, type, date")
    .eq("batch_id", batchId)
    .eq("user_id", userId)
    .is("committed_assessment_id", null);
  if (rowsError) throw rowsError;

  let committedCount = 0;
  const remaining: UncommittedDeliverable[] = [];

  for (const row of uncommitted ?? []) {
    if (row.date == null) {
      remaining.push({ id: row.id, name: row.name, reason: "no_date" });
      continue;
    }
    try {
      const { assessmentId, taskId } = await addClassAssessmentCore(
        supabase,
        userId,
        batch.class_id,
        row.name,
        row.type as AssessmentType,
        row.date
      );
      // Conditional stamp: WHERE committed_assessment_id IS NULL here too, not just in
      // the SELECT above — the only thing standing between two truly concurrent callers
      // and a duplicate assessment. `.select("id")` on the update is what makes "did this
      // actually change a row" observable to a JS caller (an UPDATE matching zero rows
      // returns an empty array, not an error).
      const { data: stamped, error: stampError } = await supabase
        .from("staged_deliverables")
        .update({ committed_assessment_id: assessmentId })
        .eq("id", row.id)
        .eq("user_id", userId)
        .is("committed_assessment_id", null)
        .select("id");
      if (stampError) throw stampError;

      if (!stamped || stamped.length === 0) {
        // Lost the race — another concurrent call already stamped this row. This
        // caller's own insert is now an orphan; clean it up rather than leave a
        // duplicate assessment (and its linked task) with nothing pointing at it.
        await supabase.from("class_assessments").delete().eq("id", assessmentId).eq("user_id", userId);
        await supabase.from("tasks").delete().eq("id", taskId).eq("user_id", userId);
      } else {
        committedCount++;
      }
    } catch (err) {
      remaining.push({ id: row.id, name: row.name, reason: "insert_failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_staging_batch", { p_batch_id: batchId });
  if (finalizeError) throw finalizeError;

  return {
    status: finalized ? "confirmed" : "confirming",
    committedCount,
    remaining,
  };
}
