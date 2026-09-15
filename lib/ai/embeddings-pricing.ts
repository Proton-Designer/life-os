/**
 * Embedding pricing (P2-13). Kept separate from `lib/ai/pricing.ts`'s
 * `estimateMultiProviderWorstCaseCostUsd` -- that function is shaped for
 * chat calls (promptChars/maxTokens, prompt+completion tokens); an
 * embeddings call is input-tokens-only, no completion side. Coordinated
 * with Sonnet ENG 1 (lib/ai owner) before writing this file rather than
 * editing pricing.ts directly -- same "own file, don't touch theirs"
 * boundary `lib/ai/transcription-pricing.ts` already established for
 * audio, itself following P2-20's Canvas precedent.
 *
 * ONE NUMBER PER PROVIDER, NOT PER DIMENSION: both providers below bill
 * identically regardless of the requested output size (`dimensions`/
 * `output_dimensionality` truncates the vector, not the token cost) --
 * confirmed directly against each provider's own current docs before
 * writing this, not carried over from training-time memory (same
 * discipline `lib/ai/model-catalog.ts`'s own header insists on).
 */

export type EmbeddingProvider = "openai" | "google";

/** Source: https://developers.openai.com/api/docs/guides/embeddings -- fetched 2026-09-15. text-embedding-3-small, standard tier, input tokens only. */
export const OPENAI_EMBEDDING_USD_PER_1M_TOKENS = 0.02;
/** Source: https://ai.google.dev/gemini-api/docs/embeddings -- fetched 2026-09-15. gemini-embedding-001, input tokens only. */
export const GOOGLE_EMBEDDING_USD_PER_1M_TOKENS = 0.15;

const RATE_PER_1M: Record<EmbeddingProvider, number> = {
  openai: OPENAI_EMBEDDING_USD_PER_1M_TOKENS,
  google: GOOGLE_EMBEDDING_USD_PER_1M_TOKENS,
};

/**
 * ~4 chars/token -- the SAME approximation constant
 * `lib/self-mastery/ingestion/chunk.ts`'s (private) `estimateTokens` uses
 * for this exact codebase's own text, matched here rather than invented
 * fresh (that function isn't exported, so this is a deliberately parallel
 * constant, not an import). Slightly over-counts for English prose (worse
 * for the user, never worse for the spend gate this feeds).
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/** Same char-based approximation, summed across every input text -- exported so a caller needing a TOKEN COUNT (not a cost) for a usage-log entry, when the provider itself didn't report one, doesn't have to back-derive it from a dollar figure. See lib/ai/embeddings.ts's own use for Gemini, which never reports usage. */
export function estimateTotalTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimateTokensFromText(t), 0);
}

/** Pre-flight, upper-bound estimate from the raw input texts -- same "never under-count" posture as transcription-pricing.ts's own worst-case estimate. */
export function estimateWorstCaseEmbeddingCostUsd(provider: EmbeddingProvider, texts: string[]): number {
  return (estimateTotalTokens(texts) / 1_000_000) * RATE_PER_1M[provider];
}

/** Real cost from the provider's own reported token usage (when it reports one) -- used for the recordUsage() log after a call completes, never for the pre-flight gate. */
export function computeActualEmbeddingCostUsd(provider: EmbeddingProvider, promptTokens: number): number {
  return (promptTokens / 1_000_000) * RATE_PER_1M[provider];
}
