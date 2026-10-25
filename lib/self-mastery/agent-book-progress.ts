import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOK_STAGE_JOB_KIND, AGENT_MODEL_STAGES } from "@/lib/self-mastery/ingestion/agent-stage";
import { INGESTION_STAGE_LABEL, bucketIngestStage } from "@/lib/self-mastery/ingestion-stage";
import type { IngestStage } from "@/lib/self-mastery/types";

export interface AgentBookProgress {
  stage: string;
  stageLabel: string;
  /** Steps of the current stage the agent has finished, of the stage's total. */
  done: number;
  total: number;
  /** The ingestion job is parked waiting for the agent (as opposed to between two of its own steps). */
  parked: boolean;
}

/**
 * "Waiting for your agent: X of N steps done" for the book page. Null unless this book is actually being worked by an agent (the job is parked, or
 * a step is queued for it), so a person with their own key never sees it. RLS-scoped reads (select-own); display-only, so an error reads as nothing.
 */
export async function getAgentBookProgress(supabase: SupabaseClient, userId: string, bookId: string): Promise<AgentBookProgress | null> {
  try {
    const { data: job } = await supabase.from("ingestion_jobs").select("stage, waiting_on_agent_since").eq("book_id", bookId).eq("user_id", userId).maybeSingle();
    const row = job as { stage: string; waiting_on_agent_since: string | null } | null;
    if (!row || !(AGENT_MODEL_STAGES as readonly string[]).includes(row.stage)) return null;

    const prefix = `${bookId}:${row.stage}:`;
    const { data: steps } = await supabase
      .from("agent_jobs")
      .select("dedupe_key, status")
      .eq("user_id", userId)
      .eq("subject_id", bookId)
      .eq("kind", BOOK_STAGE_JOB_KIND)
      .like("dedupe_key", `${prefix}%`)
      .limit(5000);
    const stepRows = (steps ?? []) as { dedupe_key: string; status: string }[];
    const parked = row.waiting_on_agent_since !== null && row.waiting_on_agent_since !== undefined;
    if (!parked && !stepRows.some((s) => ["pending", "claimed", "applying"].includes(s.status))) return null;

    const done = new Set(stepRows.filter((s) => s.status === "done").map((s) => s.dedupe_key)).size;
    let total: number;
    if (row.stage === "extracting_lessons") {
      const { count } = await supabase.from("source_chunks").select("id", { count: "exact", head: true }).eq("book_id", bookId);
      total = count ?? 0;
    } else {
      const { count } = await supabase.from("lessons").select("id", { count: "exact", head: true }).eq("book_id", bookId).not("rank", "is", null);
      total = count ?? 0;
    }
    return { stage: row.stage, stageLabel: INGESTION_STAGE_LABEL[bucketIngestStage(row.stage as IngestStage)], done, total: Math.max(total, done), parked };
  } catch {
    return null;
  }
}
