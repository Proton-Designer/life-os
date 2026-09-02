/**
 * Per-stage-attempt telemetry (R9 item 5, A5 gate 2). Writes to
 * `ingestion_job_stage_attempts` (migration 107) — one row per attempt,
 * `started_at` set the moment work begins, `finished_at`/`succeeded`/
 * `tokens_in`/`tokens_out`/`error` set the moment it ends.
 *
 * WHY THIS FILE EXISTS, STATED PRECISELY: the ~58-minute ULM reference run
 * measured ~13 minutes inside `merging` that was actually the entailment
 * gate — `apps/worker/src/pipeline.ts` called `setBookProgress(db, bookId,
 * "merging", 90)` BEFORE the entailment-check loop, so the label (and by
 * extension, any timing derived from label transitions) covered work that
 * belonged to a different stage. Migration 109's own header states the
 * requirement this file exists to satisfy: "stage boundaries must bracket
 * the work, not follow it." `bracketStage` below is the mechanism —
 * `started_at` is written in the SAME call that begins the caller's work,
 * `finished_at` in the SAME call that ends it, with nothing the caller can
 * insert in between without it being caller misuse, not this file's gap
 * (see telemetry.test.ts for a demonstration of exactly that misuse, kept
 * as a permanent regression case rather than only a design note).
 *
 * `attempt` numbering is the CALLER's responsibility (reading its own
 * cursor state) — same division of labour 107's own header describes for
 * `claim_ingestion_job`. This file never guesses or increments it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type IngestStage = Database["public"]["Enums"]["ingest_stage"];

export interface StageAttemptParams {
  jobId: string;
  stage: IngestStage;
  /** Null for whole-book stages (merging, finalizing, parsing_structure); the chunk position for per-chunk stages. */
  chunkIndex?: number | null;
  /** 1-indexed. The caller's own cursor_attempt at the time this attempt starts. */
  attempt: number;
}

export interface StageAttemptHandle {
  attemptId: string;
}

export interface StageAttemptResult {
  succeeded: boolean;
  tokensIn?: number;
  tokensOut?: number;
  /** Required when succeeded is false — ingestion_job_stage_attempts_error_shape (107) enforces this at the DB too; checked here so a caller fails at the call site, not at the INSERT. */
  error?: string;
}

/** Opens a stage-attempt row. `started_at` defaults to the database's own
 * `now()` (107's column default) — this file never computes or passes a
 * timestamp itself, so there is no clock-skew question between this
 * process and the row's own record of when it began. */
export async function beginStageAttempt(
  supabase: SupabaseClient<Database>,
  params: StageAttemptParams,
): Promise<StageAttemptHandle> {
  const { data, error } = await supabase
    .from("ingestion_job_stage_attempts")
    .insert({
      job_id: params.jobId,
      stage: params.stage,
      chunk_index: params.chunkIndex ?? null,
      attempt: params.attempt,
      // The generated Insert type marks user_id required because the
      // column is NOT NULL with no DEFAULT -- it doesn't know the column is
      // trigger-derived (set_user_id_from_ingestion_job, 107), never
      // client-supplied. Whatever is passed here is unconditionally
      // overwritten by that trigger before the row is stored; the empty
      // string documents "this value is never read," not a real user id.
      user_id: "",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { attemptId: data.id };
}

/** Closes a stage-attempt row. `finished_at` is set to the moment THIS call
 * runs — the caller must call this immediately when its work ends, not
 * batched or deferred, or the same "label follows the work instead of
 * bracketing it" defect reappears one layer up. */
export async function finishStageAttempt(
  supabase: SupabaseClient<Database>,
  handle: StageAttemptHandle,
  result: StageAttemptResult,
): Promise<void> {
  if (!result.succeeded && !result.error) {
    throw new Error("finishStageAttempt: error is required when succeeded is false (ingestion_job_stage_attempts_error_shape)");
  }
  if (result.succeeded && result.error) {
    throw new Error("finishStageAttempt: error must not be set when succeeded is true (ingestion_job_stage_attempts_error_shape)");
  }
  const { error: dbError } = await supabase
    .from("ingestion_job_stage_attempts")
    .update({
      finished_at: new Date().toISOString(),
      succeeded: result.succeeded,
      tokens_in: result.tokensIn ?? null,
      tokens_out: result.tokensOut ?? null,
      error: result.error ?? null,
    })
    .eq("id", handle.attemptId);
  if (dbError) throw dbError;
}

/**
 * THE bracketing primitive. `beginStageAttempt` runs immediately before
 * `work()` starts; `finishStageAttempt` runs immediately after it settles,
 * on both the success and the failure path — never after some later,
 * unrelated piece of work has also run under the same open attempt. Return
 * the work's own result so a caller never needs a second round trip to get
 * at it.
 */
export async function bracketStage<T extends { tokensIn?: number; tokensOut?: number }>(
  supabase: SupabaseClient<Database>,
  params: StageAttemptParams,
  work: () => Promise<T>,
): Promise<T> {
  const handle = await beginStageAttempt(supabase, params);
  try {
    const result = await work();
    await finishStageAttempt(supabase, handle, {
      succeeded: true,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    return result;
  } catch (e) {
    await finishStageAttempt(supabase, handle, {
      succeeded: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
