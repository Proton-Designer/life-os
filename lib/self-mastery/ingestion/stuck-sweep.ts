import type { SupabaseClient } from "@supabase/supabase-js";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";

/**
 * Books that will never finish on their own, found by the step route on every poll (the cron hits it each minute):
 *   - 'processing' with NO ingestion_jobs row, for over NO_JOB_AFTER_MS. finalizeBookUpload used to leave these when the
 *     job insert failed, and anything that took a job row away leaves the same thing. Nothing would ever claim them.
 *   - a job that is not done/failed and has not been touched for over STALLED_AFTER_MS. updated_at moves on every claim,
 *     advance and failure, and one step is one chunk (a lease is 6 minutes), so an hour of silence is a dead job.
 * Both are marked FAILED with a message that is retryable, so the library shows "Try again" (retry_book_ingestion, 271).
 *
 * Bounded (SWEEP_LIMIT rows per query per poll, oldest first) and idempotent: every write is guarded by the state it
 * expects, so a second poll, or two polls at once, finds nothing left to do for a book already failed.
 * Never throws: the poll's real work (claiming a job) must not depend on housekeeping.
 */
export const NO_JOB_AFTER_MS = 10 * 60 * 1000;
export const STALLED_AFTER_MS = 60 * 60 * 1000;
export const SWEEP_LIMIT = 25;
export const STUCK_BOOK_MESSAGE = "This book stopped making progress while it was being processed. Tap Try again.";

export type SweepResult = { failedNoJob: number; failedStalled: number };

export async function sweepStuckBooks(supabase: SupabaseClient, now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { failedNoJob: 0, failedStalled: 0 };
  try {
    // 1. processing books with no job row.
    const noJobCutoff = new Date(now.getTime() - NO_JOB_AFTER_MS).toISOString();
    const { data: processing } = await untypedFrom(supabase, "books")
      .select("id")
      .eq("status", "processing")
      .lt("created_at", noJobCutoff)
      .order("created_at", { ascending: true })
      .limit(SWEEP_LIMIT)
      .returns<{ id: string }[]>();
    const processingIds = (processing ?? []).map((b) => b.id);
    if (processingIds.length > 0) {
      const { data: jobs } = await untypedFrom(supabase, "ingestion_jobs").select("book_id").in("book_id", processingIds).returns<{ book_id: string }[]>();
      const withJob = new Set((jobs ?? []).map((j) => j.book_id));
      for (const id of processingIds.filter((i) => !withJob.has(i))) {
        const { error } = await untypedFrom(supabase, "books").update({ status: "failed", error_message: STUCK_BOOK_MESSAGE }).eq("id", id).eq("status", "processing");
        if (!error) result.failedNoJob += 1;
      }
    }

    // 2. jobs that stopped moving.
    const stalledCutoff = new Date(now.getTime() - STALLED_AFTER_MS).toISOString();
    const { data: stalled } = await untypedFrom(supabase, "ingestion_jobs")
      .select("id, book_id")
      .not("stage", "in", "(done,failed)")
      .lt("updated_at", stalledCutoff)
      .order("updated_at", { ascending: true })
      .limit(SWEEP_LIMIT)
      .returns<{ id: string; book_id: string }[]>();
    for (const job of stalled ?? []) {
      const { error: jobError } = await untypedFrom(supabase, "ingestion_jobs")
        .update({ stage: "failed", last_error: `stalled: no progress for over ${STALLED_AFTER_MS / 60000} minutes (swept)` })
        .eq("id", job.id)
        .not("stage", "in", "(done,failed)");
      if (jobError) continue;
      await untypedFrom(supabase, "books").update({ status: "failed", error_message: STUCK_BOOK_MESSAGE }).eq("id", job.book_id).eq("status", "processing");
      result.failedStalled += 1;
    }
  } catch (e) {
    console.error("[self-mastery ingestion] stuck-book sweep failed", e instanceof Error ? e.message : e);
  }
  return result;
}
