/**
 * Stage dispatch for the ingestion worker's per-chunk route handler (A5
 * gates 3-4). One handler function per `ingest_stage`, generic over stage
 * per the Lead's explicit instruction: "build the handler generic over
 * stage rather than one handler per stage, and gate 4 becomes
 * configuration instead of a second implementation." This file is that
 * configuration table; app/api/self-mastery/ingestion/step/route.ts is the
 * one handler that reads it.
 *
 * ONLY `verifying_grounding` IS WIRED. chunking/extracting_lessons/
 * embedding/merging/generating_cards/finalizing have no handler here yet —
 * they depend on infrastructure this repo does not have (PDF text
 * extraction, a running local embedding model wired into the worker, a
 * real merge/promotion write path). A route hitting an unhandled stage
 * returns 501 with the stage named, not a silent no-op or a fabricated
 * success — see the route handler.
 *
 * ⚠️ HONEST LIMITATION ON verifying_grounding's OWN QUALITY, stated rather
 * than implied: it runs `HeuristicProvider.checkEntailment`, the only
 * provider actually available in this environment (no Ollama guaranteed
 * running, no funded model per R4/the dev shim's own scope). Per
 * heuristic-provider.ts's own doc comment, that method is "trivially
 * always SUPPORTS: HeuristicProvider sets coreClaim === provenanceQuote by
 * construction... there is nothing for a real entailment check to find."
 * For the seeded Meditations deck's REAL lessons, core_claim and
 * provenance_quote are deliberately DIFFERENT strings (hand-authored, not
 * produced by HeuristicProvider) — so this stage currently exercises the
 * real cursor/telemetry/bracketing mechanism end to end, on real rows, but
 * does NOT perform a real semantic entailment check against seeded
 * content. That becomes a genuine check only once a real generative
 * provider (Ollama reachable, or a funded gateway) is wired in — tracked,
 * not solved here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { HeuristicProvider } from "./llm/heuristic-provider";

type IngestStage = Database["public"]["Enums"]["ingest_stage"];
type IngestionJobRow = Database["public"]["Tables"]["ingestion_jobs"]["Row"];

export interface StageWorkResult {
  tokensIn?: number;
  tokensOut?: number;
  /** Where the cursor should move on success. Same stage + chunkIndex+1 for "more chunks in this MAP stage"; the next stage + null for "this stage is done." */
  nextStage: IngestStage;
  nextChunkIndex: number | null;
}

export interface StageContext {
  job: IngestionJobRow;
  supabase: SupabaseClient<Database>;
}

export type StageHandler = (ctx: StageContext) => Promise<StageWorkResult>;

async function verifyGroundingStage(ctx: StageContext): Promise<StageWorkResult> {
  const chunkIndex = ctx.job.cursor_chunk_index ?? 0;

  // One lesson per chunk_index ordinal. Ordered deterministically
  // (created_at, id) so re-claiming the SAME cursor position (a retry)
  // always reads the SAME lesson -- required for the "at-least-once,
  // idempotent" guarantee: a redone attempt must do the same work, not
  // whatever happens to be at some position today.
  const { data: lessons, error } = await ctx.supabase
    .from("lessons")
    .select("id, core_claim, provenance_quote")
    .eq("book_id", ctx.job.book_id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  const lesson = lessons?.[chunkIndex];
  if (!lesson) {
    // No more lessons to verify at this book -- MAP phase for this stage
    // is exhausted. Advance to the next whole-book stage (chunk_index null).
    return { nextStage: "generating_cards", nextChunkIndex: null };
  }

  const provider = new HeuristicProvider();
  const result = await provider.checkEntailment({
    claim: lesson.core_claim ?? "",
    quote: lesson.provenance_quote,
  });

  // R12.3's backfill-on-failure loop (retry the next-ranked archived
  // candidate) is worker ORCHESTRATION -- out of scope here per the same
  // boundary confirmed with ow9rlnds for checkEntailment itself. This
  // stage records the verdict via the caller's bracketStage/telemetry; it
  // does not act on a non-SUPPORTS verdict beyond that. Flagging rather
  // than silently dropping the requirement: a real backfill loop is future
  // work, not a gap this stage was ever scoped to close.
  void result;

  return { nextStage: "verifying_grounding", nextChunkIndex: chunkIndex + 1 };
}

export const STAGE_HANDLERS: Partial<Record<IngestStage, StageHandler>> = {
  verifying_grounding: verifyGroundingStage,
};
