import { MODEL_CATALOG } from "./model-catalog";

/**
 * Transcription pricing for lecture-capture (P3-15). Kept separate from
 * `lib/ai/pricing.ts`'s `estimateMultiProviderWorstCaseCostUsd` -- that
 * function is shaped for chat calls (promptChars/maxTokens); audio
 * transcription is billed per minute of audio (OpenAI) or as audio input
 * tokens (Gemini), a structurally different unit. Coordinated with
 * Sonnet ENG 1 (lib/ai owner) and tracking-app-a9 before writing this file
 * rather than forcing audio through the chat estimator or editing pricing.ts
 * directly -- same "own file, don't touch theirs" boundary P2-20 already
 * established for Canvas. Team A can fold this table into pricing.ts later
 * if they want one unified price source; this file is deliberately
 * self-contained until then.
 *
 * TWO SEPARATE NUMBERS, ON PURPOSE (same split gatewayChat/checkMonthlySpendCap
 * already use for chat calls):
 *   - `estimateWorstCaseTranscriptionCostUsd` -- a PRE-FLIGHT, upper-bound
 *     estimate from file size alone (no audio has been sent to a provider
 *     yet, so there's no real duration to measure). Deliberately biased
 *     HIGH (assumes a low, voice-call-grade bitrate, which maximizes the
 *     size-to-duration ratio) so the spend gate never under-counts.
 *   - `computeActualTranscriptionCostUsd` -- the REAL cost, computed from
 *     the provider's own reported duration after the call completes, for
 *     the `recordUsage()` log. Never derived from the worst-case estimate.
 */

export type TranscriptionProvider = "openai" | "google";

/** Source: https://platform.openai.com/docs/pricing -- fetched 2026-09-15. Whisper (`whisper-1`), per-minute, rounded up to the nearest second by OpenAI's own billing. */
export const OPENAI_WHISPER_USD_PER_MINUTE = 0.006;

/**
 * Source: https://ai.google.dev/gemini-api/docs/audio -- fetched 2026-09-15.
 * Gemini bills audio input as ~32 tokens per second of audio, at the
 * model's normal input-token rate -- not a separate per-minute audio price.
 * Reuses MODEL_CATALOG's own budget-tier Google input rate (same "cheap
 * tier by default" convention lib/ai/providers.ts already applies to every
 * other feature) rather than inventing a second number for the same model.
 */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
const GEMINI_INPUT_USD_PER_1M = MODEL_CATALOG.google.budget.inputUsdPer1M;

/**
 * Worst-case bytes-to-seconds ratio: a conservative LOW bitrate (64 kbps --
 * plausible for a compressed mono voice recording), which is the bitrate
 * that produces the MOST estimated seconds -- and therefore the highest
 * cost estimate -- for a given file size. A higher-bitrate/shorter-duration
 * file only ever costs LESS than this estimate, never more, which is the
 * "never under-count" property the pre-flight gate needs.
 */
const WORST_CASE_BITRATE_BPS = 64_000;

function estimateWorstCaseDurationSeconds(sizeBytes: number): number {
  return (sizeBytes * 8) / WORST_CASE_BITRATE_BPS;
}

function costForProvider(provider: TranscriptionProvider, durationSeconds: number): number {
  if (provider === "openai") {
    return (durationSeconds / 60) * OPENAI_WHISPER_USD_PER_MINUTE;
  }
  const tokens = durationSeconds * GEMINI_AUDIO_TOKENS_PER_SECOND;
  return (tokens / 1_000_000) * GEMINI_INPUT_USD_PER_1M;
}

/** Pre-flight, upper-bound estimate from file size alone -- see this file's own header. */
export function estimateWorstCaseTranscriptionCostUsd(provider: TranscriptionProvider, sizeBytes: number): number {
  return costForProvider(provider, estimateWorstCaseDurationSeconds(sizeBytes));
}

/**
 * Real cost from the provider's own reported duration -- used for the
 * recordUsage() log after a call completes, never for the pre-flight gate.
 */
export function computeActualTranscriptionCostUsd(provider: TranscriptionProvider, durationSeconds: number): number {
  return costForProvider(provider, durationSeconds);
}
