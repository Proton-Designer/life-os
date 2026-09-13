import "server-only";

/**
 * DeepSeek's published per-token pricing, fetched directly from
 * https://api-docs.deepseek.com/quick_start/pricing on 2026-09-13 while
 * building the LLM gateway (not estimated, not carried over from an older
 * "deepseek-chat"-era number -- this codebase had no pricing table before
 * this file). DeepSeek's own page: "Product prices may vary and DeepSeek
 * reserves the right to adjust them" -- re-fetch and update this table if
 * that ever happens; `estimateCostUsd()`'s ARITHMETIC does not depend on
 * these exact figures being current, only its DOLLAR OUTPUT does, and the
 * real-balance check in `lib/ai/balance.ts` is the ground-truth cross-check
 * that catches this table going stale.
 *
 * Units: USD per 1,000,000 tokens. Two rates per token class because
 * DeepSeek prices PEAK time at exactly double OFF-PEAK (their footnote (3)):
 * peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday --
 * all other hours, and all of Saturday/Sunday, are off-peak.
 */
export const DEEPSEEK_PRICING_USD_PER_1M = {
  "deepseek-flash": {
    cacheHitInput: { offPeak: 0.003, peak: 0.006 },
    cacheMissInput: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
  },
  "deepseek-v4-pro": {
    cacheHitInput: { offPeak: 0.022, peak: 0.044 },
    cacheMissInput: { offPeak: 0.66, peak: 1.32 },
    output: { offPeak: 1.98, peak: 3.96 },
  },
} as const;

export type PricedModel = keyof typeof DEEPSEEK_PRICING_USD_PER_1M;

export function isPricedModel(model: string): model is PricedModel {
  return Object.prototype.hasOwnProperty.call(DEEPSEEK_PRICING_USD_PER_1M, model);
}

/**
 * DeepSeek's peak window is a fixed UTC clock range, defined by the provider
 * itself -- NOT a calendar date derived for any particular user. This is
 * deliberately NOT routed through `lib/date-utils.ts`'s `localDateString`/
 * `resolveLocalTime`: those exist so a CALENDAR DAY is computed in a user's
 * own timezone (the UTC-vs-local-evening rollover bug class this repo has
 * shipped more than once). A billing window that DeepSeek itself states in
 * UTC, with no per-user timezone involved at all, is exactly the case where
 * reading raw UTC clock fields off a `Date` is correct, not the mistake that
 * rule guards against. Do not "fix" this to use the local-time helpers --
 * that would make the cost of the SAME API call depend on the caller's
 * timezone, which is not how DeepSeek bills it.
 */
export function isPeakUtc(at: Date): boolean {
  const day = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export interface UsageTokens {
  /** Total prompt/input tokens billed (cache hit + cache miss). */
  promptTokens: number;
  /** Of promptTokens, how many hit DeepSeek's context cache (billed far cheaper). */
  cachedPromptTokens: number;
  /** Total completion/output tokens billed -- INCLUDES reasoning tokens (DeepSeek bills them as output). */
  completionTokens: number;
  /** Of completionTokens, how many were hidden chain-of-thought (`reasoning_content`), not visible answer text. */
  reasoningTokens: number;
}

/**
 * The one place a dollar figure gets computed. Every field of `UsageTokens`
 * is billed at the OUTPUT rate or an INPUT rate -- reasoning tokens are NOT
 * a separate, cheaper class; DeepSeek bills them as ordinary output tokens
 * (this is exactly why `reasoning_tokens` must be recorded separately in the
 * usage log: cost-per-USEFUL-token is far worse than the completion-token
 * total alone suggests, even though the DOLLAR cost is already correct
 * without the split).
 */
export function estimateCostUsd(model: string, tokens: UsageTokens, at: Date = new Date()): number {
  if (!isPricedModel(model)) {
    // An unpriced model must never silently cost $0 -- that would let the
    // spend cap admit unlimited calls on a model this table doesn't know
    // about yet. Fail toward the MORE expensive assumption instead: price it
    // as deepseek-v4-pro (the most expensive priced model today), so a gap
    // in this table under-admits rather than over-admits against the cap.
    model = "deepseek-v4-pro";
  }
  const rates = DEEPSEEK_PRICING_USD_PER_1M[model as PricedModel];
  const peak = isPeakUtc(at);
  const cacheHitTokens = Math.min(tokens.cachedPromptTokens, tokens.promptTokens);
  const cacheMissTokens = Math.max(tokens.promptTokens - cacheHitTokens, 0);

  const cacheHitRate = peak ? rates.cacheHitInput.peak : rates.cacheHitInput.offPeak;
  const cacheMissRate = peak ? rates.cacheMissInput.peak : rates.cacheMissInput.offPeak;
  const outputRate = peak ? rates.output.peak : rates.output.offPeak;

  const cost =
    (cacheHitTokens / 1_000_000) * cacheHitRate +
    (cacheMissTokens / 1_000_000) * cacheMissRate +
    (tokens.completionTokens / 1_000_000) * outputRate;

  return cost;
}

/**
 * Worst-case cost of a call BEFORE it's made, for the spend cap's pre-flight
 * check (`lib/ai/spend-cap.ts`). Uses `maxTokens` as the completion-token
 * count (the API-enforced ceiling, so real usage can never exceed it) and a
 * conservative ~4-chars-per-token estimate for the prompt, assuming ZERO
 * cache hit (the more expensive assumption) so the estimate never
 * UNDER-counts what a call could cost.
 */
export function estimateWorstCaseCostUsd(model: string, promptChars: number, maxTokens: number, at: Date = new Date()): number {
  const estimatedPromptTokens = Math.ceil(promptChars / 4);
  return estimateCostUsd(
    model,
    {
      promptTokens: estimatedPromptTokens,
      cachedPromptTokens: 0,
      completionTokens: maxTokens,
      reasoningTokens: 0,
    },
    at,
  );
}
