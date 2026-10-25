import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStagingBatchCore, createStagedDeliverablesCore, type StagingBatchSource } from "@/lib/school/staging-core";
import type { ExtractedItem } from "@/lib/school/syllabus-extraction";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function findBatchForJob(supabase: SupabaseClient, userId: string, jobId: string): Promise<string | null> {
  const { data, error } = await supabase.from("staging_batches").select("id").eq("user_id", userId).eq("agent_job_id", jobId).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

async function batchHasItems(supabase: SupabaseClient, userId: string, batchId: string): Promise<boolean> {
  const { count, error } = await supabase.from("staged_deliverables").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("batch_id", batchId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Stages an agent job's extracted items AT MOST ONCE per job. If the apply succeeded but `complete_agent_job` failed, the job sits in
 * 'applying'; the sweep returns it to pending and another agent run applies it again. The batch carries the job id (migration 280:
 * unique per (user, job)), so that second apply finds the first batch instead of creating another, and a crash between the batch and its
 * items is repaired (the items are added only if the batch has none).
 */
export async function stageItemsForJob(
  supabase: SupabaseClient,
  userId: string,
  args: { jobId: string; classId: string; source: StagingBatchSource; rawText?: string; items: ExtractedItem[] },
): Promise<string> {
  let batchId = await findBatchForJob(supabase, userId, args.jobId);
  if (!batchId) {
    try {
      batchId = await createStagingBatchCore(supabase, userId, args.classId, args.source, args.rawText, undefined, undefined, args.jobId);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      batchId = await findBatchForJob(supabase, userId, args.jobId); // lost a race with a concurrent apply of the same job
      if (!batchId) throw e;
    }
  }
  if (!(await batchHasItems(supabase, userId, batchId))) await createStagedDeliverablesCore(supabase, userId, batchId, args.items);
  return batchId;
}
