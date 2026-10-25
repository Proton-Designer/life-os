/**
 * Multi-provider AI catalog (Phase 1, 2026-09-14, Ayman's request via the
 * Phase-1 Opus lead). Every model ID and price below was fetched from that
 * provider's own official docs on 2026-09-14 — never carried over from
 * training-time memory, per the Lead's explicit instruction ("your
 * knowledge of these IDs is stale by months; a wrong model string is a 400
 * for every user who picks it"). Source URL and fetch date are recorded
 * next to every entry so staleness is auditable later, same discipline
 * `lib/ai/pricing.ts`'s DeepSeek table already established.
 *
 * THIS IS NOT THE ONLY SAFETY NET. A model string here can still go stale
 * between now and when a user picks it — the "Test key" action (api-key-
 * actions.ts) is what catches that FOR REAL, by making one real call
 * against the exact catalog model id at setup time, not by trusting this
 * file to stay perfectly current. This file is the best-evidence starting
 * point; the live test call is the actual guarantee.
 *
 * TWO ENTRIES CARRY A KNOWN RISK, flagged by the Lead, recorded here so it
 * isn't rediscovered as a mystery:
 * - Gemini flagship: `gemini-2.5-pro` was chosen over the newer
 *   `gemini-3.1-pro-preview` specifically because 2.5-pro is GA and 3.1 is
 *   still preview-labeled (preview ids get renamed/retired with little
 *   notice) — re-check ai.google.dev/gemini-api/docs/models when 3.1
 *   reaches GA, since it will likely become the better flagship pick then.
 * - Grok budget: `grok-build-0.1` was REJECTED despite being marginally
 *   cheaper than `grok-4.3` ($1.00/$2.00 vs $1.25/$2.50 under 200k tokens)
 *   because its name strongly suggests a coding/build-agent specialization
 *   docs.x.ai's own recommendations text never contradicted ("For
 *   everything else, including code, use Grok 4.6" — grok-build-0.1 isn't
 *   even mentioned there). `grok-4.3` is the same numbered flagship family
 *   as `grok-4.6` at a cheaper point release, with no specialized naming —
 *   the safer bet for a GENERAL-purpose budget model.
 *
 * STALENESS CHECK 2026-10-25 (against each provider's own docs): updated above where the replacement id AND price were
 * verified (Anthropic -> Claude 5.5 family, OpenAI budget -> gpt-6-luna, xAI flagship -> grok-4.7). STILL STALE, left alone
 * because the replacement could not be verified: (1) google flagship `gemini-2.5-pro` is two generations back (newer:
 * gemini-3.1-pro-preview, gemini-3.8-flash, gemini-4-argon; Argon's price was not found); google budget
 * `gemini-3.5-flash-lite` is labelled previous-generation but available. (2) moonshot budget `kimi-k2.6`: the K2 series is
 * closed to NEWLY REGISTERED users from 2026-10-31 and retired by the end of December 2026; the replacement line (kimi-k3,
 * kimi-k3.1-pro) always thinks (no way to disable) and costs several times more, kimi-k3.1-pro's price was not found; the
 * flagship `kimi-k3` is previous-generation. A new Kimi user after 2026-10-31 will fail "Test key" on kimi-k2.6.
 */

export interface CatalogModel {
  id: string;
  /** USD per 1,000,000 tokens. DeepSeek's peak/off-peak split lives in pricing.ts, not here — this is the flat/standard-tier rate every other provider quotes directly. */
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  source: string;
  fetchedAt: string;
}

export interface CatalogEntry {
  flagship: CatalogModel;
  budget: CatalogModel;
  /** Only DeepSeek and Claude have one today — omit rather than force every provider to have three tiers. */
  mid?: CatalogModel;
}

export const MODEL_CATALOG: Record<string, CatalogEntry> = {
  deepseek: {
    // Priced in lib/ai/pricing.ts's DEEPSEEK_PRICING_USD_PER_1M (peak/off-peak
    // split, fetched 2026-09-13) — figures below are the OFF-PEAK rate only,
    // for display/comparison purposes; estimateCostUsd() is the real source
    // of truth for what a DeepSeek call actually costs.
    flagship: { id: "deepseek-v4-pro", inputUsdPer1M: 0.66, outputUsdPer1M: 1.98, source: "https://api-docs.deepseek.com/quick_start/pricing", fetchedAt: "2026-09-13" },
    budget: { id: "deepseek-flash", inputUsdPer1M: 0.15, outputUsdPer1M: 0.6, source: "https://api-docs.deepseek.com/quick_start/pricing", fetchedAt: "2026-09-13" },
  },
  anthropic: {
    // UPDATED 2026-10-25 to the Claude 5.5 generation (ids and prices from the current Anthropic API model reference).
    // The old entries (claude-opus-5 $5/$25, claude-sonnet-5 $2/$10, claude-haiku-4-5 $1/$5) are all still served, just not current.
    // Haiku 5.5's list price steps up for prompts over 100K tokens ($0.50 / $2.50): this flat rate is right for ingestion
    // (a few thousand tokens a call) and would under-estimate a very long prompt.
    flagship: { id: "claude-opus-5-5", inputUsdPer1M: 4, outputUsdPer1M: 20, source: "Anthropic API model reference (Claude Opus 5.5)", fetchedAt: "2026-10-25" },
    budget: { id: "claude-haiku-5-5", inputUsdPer1M: 0.1, outputUsdPer1M: 0.5, source: "Anthropic API model reference (Claude Haiku 5.5, prompts up to 100K tokens)", fetchedAt: "2026-10-25" },
    mid: { id: "claude-sonnet-5-5", inputUsdPer1M: 2, outputUsdPer1M: 10, source: "Anthropic API model reference (Claude Sonnet 5.5)", fetchedAt: "2026-10-25" },
  },
  openai: {
    flagship: { id: "gpt-6-astra", inputUsdPer1M: 10, outputUsdPer1M: 50, source: "https://developers.openai.com/api/docs/pricing", fetchedAt: "2026-09-14" },
    // UPDATED 2026-10-25: gpt-5-nano (and gpt-5.4-nano) are marked Deprecated on OpenAI's all-models page; their stated
    // replacement for cost-sensitive high-volume work is GPT-6 Luna (gpt-6-luna, $0.10 / $0.50 per 1M, reasoning none..max).
    budget: { id: "gpt-6-luna", inputUsdPer1M: 0.1, outputUsdPer1M: 0.5, source: "https://developers.openai.com/api/docs/models", fetchedAt: "2026-10-25" },
  },
  google: {
    // gemini-2.5-pro chosen over the newer gemini-3.1-pro-preview -- see
    // this file's own header for why (GA vs. preview).
    flagship: { id: "gemini-2.5-pro", inputUsdPer1M: 1.25, outputUsdPer1M: 10, source: "https://ai.google.dev/gemini-api/docs/pricing", fetchedAt: "2026-09-14" },
    budget: { id: "gemini-3.5-flash-lite", inputUsdPer1M: 0.3, outputUsdPer1M: 2.5, source: "https://ai.google.dev/gemini-api/docs/pricing", fetchedAt: "2026-09-14" },
  },
  moonshot: {
    flagship: { id: "kimi-k3", inputUsdPer1M: 3, outputUsdPer1M: 15, source: "https://platform.kimi.ai/docs/pricing", fetchedAt: "2026-09-14" },
    budget: { id: "kimi-k2.6", inputUsdPer1M: 0.95, outputUsdPer1M: 4, source: "https://platform.kimi.ai/docs/pricing", fetchedAt: "2026-09-14" },
  },
  xai: {
    // grok-build-0.1 deliberately NOT used as budget -- see this file's own
    // header for why.
    // UPDATED 2026-10-25: grok-4.7 is xAI's current flagship at the same price as grok-4.6 ($2 / $6, under 200k prompt tokens).
    flagship: { id: "grok-4.7", inputUsdPer1M: 2, outputUsdPer1M: 6, source: "https://docs.x.ai/developers/pricing", fetchedAt: "2026-10-25" },
    budget: { id: "grok-4.3", inputUsdPer1M: 1.25, outputUsdPer1M: 2.5, source: "https://docs.x.ai/docs/models", fetchedAt: "2026-09-14" },
  },
};

export type CatalogProviderId = keyof typeof MODEL_CATALOG;
