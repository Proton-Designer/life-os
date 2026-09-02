/**
 * Stage dispatch for the ingestion worker's per-chunk route handler (A5
 * gates 3-4, item 7b). One handler function per `ingest_stage`, generic
 * over stage per the Lead's explicit instruction: "build the handler
 * generic over stage rather than one handler per stage, and gate 4 becomes
 * configuration instead of a second implementation." This file is that
 * configuration table; app/api/self-mastery/ingestion/step/route.ts is the
 * one handler that reads it.
 *
 * ONLY `verifying_grounding` IS WIRED. chunking/extracting_lessons/
 * embedding/merging/generating_cards/finalizing have no handler here yet —
 * they depend on infrastructure this repo does not have. A route hitting
 * an unhandled stage returns 501 with the stage named, not a silent no-op.
 *
 * ⚠️ FAIL CLOSED WHEN NO REAL PROVIDER IS AVAILABLE — R43, and it reverses
 * this file's own earlier behaviour. The first version of this stage ran
 * `HeuristicProvider.checkEntailment` as a fallback when no real model was
 * configured, and recorded the attempt as a normal success. That was
 * wrong: `HeuristicProvider.checkEntailment` is trivially always SUPPORTS
 * by construction — it never actually evaluates the claim/quote pair — so
 * running it and marking the row is admitting an ungated lesson with an
 * asterisk. R12.3 already ruled the firewall's OTHER semantic arm (the
 * embedding-relevance floor) fails closed on unavailability rather than
 * degrading and annotating; this stage now matches that discipline rather
 * than being the one place the firewall quietly downgrades itself. If
 * `getDevProviderBaseUrl()` (dev/shim) or a future funded provider isn't
 * available, this stage THROWS — the attempt records as a genuine failure
 * (bracketStage), the chunk retries, and it never silently "passes."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DevShimProvider } from "./llm/dev-shim-provider";

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

  const provider = DevShimProvider.fromEnv();
  if (!provider) {
    // FAIL CLOSED (R43). No annotation, no fallback, no marked-pass with a
    // caveat -- an entailment check that cannot actually check must not
    // produce a row that looks like one that did. The chunk retries
    // (claim_ingestion_job) up to max_attempts (gate 5), same as any other
    // stage failure.
    throw new Error(
      "verifying_grounding: no real entailment provider available (SELF_MASTERY_DEV_PROVIDER_URL unset, or NODE_ENV=production) -- refusing to fall back to a trivially-always-SUPPORTS check.",
    );
  }

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
  // work, not a gap this stage was ever scoped to close. Unlike the
  // no-provider case above, a CONTRADICTS/UNRELATED verdict from a REAL
  // check is a legitimate, meaningful result -- it is not this stage's job
  // to decide what happens next with it.
  void result;

  return {
    nextStage: "verifying_grounding",
    nextChunkIndex: chunkIndex + 1,
    tokensIn: provider.lastUsage?.promptTokens,
    tokensOut: provider.lastUsage?.completionTokens,
  };
}

export const STAGE_HANDLERS: Partial<Record<IngestStage, StageHandler>> = {
  verifying_grounding: verifyGroundingStage,
};
