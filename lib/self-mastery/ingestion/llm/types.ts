/**
 * ULM ADR-004: all LLM-shaped work sits behind this interface.
 *
 * TWO implementations exist today, both ported below:
 *   - `OllamaProvider`     — local qwen2.5 (7B judgment / 3B mechanical), ULM's research path.
 *   - `HeuristicProvider`  — deterministic, keyless, NOT a stub; it must produce a
 *                            genuinely usable deck, since it is what runs without a worker.
 *
 * There is NO `AnthropicProvider`, in this port or in ULM. Nothing anywhere reads
 * ANTHROPIC_API_KEY. A provider against this interface, routed through the AI
 * gateway (BYO key / CollegeOS's gateway), is real implementation work, not a
 * config flip — see boss-handoff/00-START-HERE.md's "five things" for the
 * incident this note exists to prevent repeating.
 */
import type { Database } from "@/lib/supabase/database.types";

// Derived from the generated schema, never hand-written — a hand-written
// union mirroring a CHECK/enum is exactly the drift class that let ULM's own
// EvidenceStrength read "strong_research_base" where the live DB enum said
// "strong_research" for a period, with every consuming call site carrying a
// manual remap to paper over it.
export type EvidenceStrength = Database["public"]["Enums"]["evidence_strength"];
export type PromptType = Database["public"]["Enums"]["prompt_type"];

export interface ChunkTriageInput {
  chunkText: string;
}

export interface ChunkTriageResult {
  hasExtractableLesson: boolean;
  confidence: number;
}

export interface ExtractLessonsInput {
  chunkText: string;
  pageStart: number;
  pageEnd: number;
  /** The chunk's own DB id, already known to the caller at this point in the pipeline. */
  sourceChunkId: string;
}

export interface CandidateLesson {
  title: string;
  coreClaim: string;
  mechanism: string;
  actionTemplate: string;
  evidenceStrength: EvidenceStrength;
  /** Must verbatim-match a substring of the source chunk — enforced provider-independently. */
  provenanceQuote: string;
  pageRef: number;
  sourceChunkId: string;
}

export interface MergeLessonsInput {
  candidates: CandidateLesson[];
  targetCount: { min: number; max: number };
}

export interface GenerateCardsInput {
  lesson: CandidateLesson;
}

export interface GeneratedCard {
  promptType: PromptType;
  prompt: string;
  answer: string;
}

export interface GradeAnswerInput {
  cardPrompt: string;
  cardAnswer: string;
  userAnswer: string;
}

export interface GradeAnswerResult {
  suggestedRating: 1 | 2 | 3 | 4;
  feedback: string;
}

export interface EntailmentCheckInput {
  claim: string;
  quote: string;
}

/**
 * Verbatim grounding + embedding-cosine relevance both pass a quote that
 * CONTRADICTS its claim (topically close, factually opposed — cosine cannot
 * see this, only meaning can). This is the final provenance check, run once
 * per surviving (post-merge) lesson, never per raw candidate.
 *
 * Stateless by design (confirmed with ow9rlnds, 2026-09-02, re: 109's new
 * `verifying_grounding` chunked stage): this function is a pure
 * (claim, quote) -> verdict leaf. Chunk position, retry count, and the
 * backfill-next-candidate loop on a non-SUPPORTS verdict are the future
 * worker's orchestration concern (apps/worker/src/pipeline.ts in ULM's
 * reference implementation) — not ported here, and this interface must not
 * grow awareness of them. If you're wiring this under the cursor model,
 * `verifying_grounding` (ingest_stage) is the stage name to cross-reference.
 */
export interface EntailmentCheckResult {
  verdict: "SUPPORTS" | "CONTRADICTS" | "UNRELATED";
  reason: string;
}

export interface LlmProvider {
  triageChunk(input: ChunkTriageInput): Promise<ChunkTriageResult>;
  extractLessons(input: ExtractLessonsInput): Promise<CandidateLesson[]>;
  mergeLessons(input: MergeLessonsInput): Promise<CandidateLesson[]>;
  generateCards(input: GenerateCardsInput): Promise<GeneratedCard[]>;
  gradeAnswer(input: GradeAnswerInput): Promise<GradeAnswerResult>;
  checkEntailment(input: EntailmentCheckInput): Promise<EntailmentCheckResult>;
}
