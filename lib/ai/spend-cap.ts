import "server-only";
import { estimateWorstCaseCostUsd } from "./pricing";
import { getDefaultUsageStore, type UsageStore } from "./usage-log";
import type { KeySource } from "./resolve-key";

/**
 * The hard spend ceiling on the SHARED, operator-funded DeepSeek key.
 *
 * SCOPE: GLOBAL, on the 'server' key source only -- not per-user, not
 * per-feature. Argued explicitly, not a default fallen into:
 *
 *   - The real constraint is one DeepSeek ACCOUNT with one balance
 *     ($1.98 total when this was built, verified against `/user/balance`,
 *     not estimated). That balance doesn't care which user or which feature
 *     drew it down -- it is a single shared resource, so the cap that
 *     actually protects it must also be single and shared.
 *   - A user's OWN key (`resolveApiKeyWithSource` returns `source: "user"`)
 *     is never gated here at all. It is their money and their DeepSeek
 *     account; capping it would be paternalistic and would protect nothing
 *     of ours. `checkSpendCap` returns `allowed: true` unconditionally for
 *     `keySource !== "server"` -- see below.
 *   - Per-feature sub-budgets were considered and rejected FOR NOW: with a
 *     total lifetime balance under $2, splitting it into per-feature slices
 *     adds bookkeeping (what's a fair split between answer-feedback and
 *     ingestion, re-litigated every time a feature is added) without
 *     protecting anything a single global ceiling doesn't already protect.
 *     The usage log already carries `feature` on every row, so a per-feature
 *     cap can be layered on top later, purely as a new query against
 *     existing data, without touching this function's shape.
 *   - Per-user sub-limits have the same "not yet, not never" answer: useful
 *     once there are enough real users sharing the fallback key that one
 *     could starve the others, not useful with the userbase this was built
 *     for. Same "add a query later" escape hatch via `user_id` on every row.
 *
 * LIFETIME, NOT DAILY: the $1.98 is the account's entire remaining balance,
 * not a recurring allowance -- DeepSeek doesn't top it up on a schedule, so
 * there is no time window to reset a "spent so far" counter against. The cap
 * sums ALL TIME.
 *
 * PRE-FLIGHT, ESTIMATE-BASED, NOT PERFECT: token counts are only known AFTER
 * a call completes, so admission is decided against a WORST-CASE estimate
 * (`estimateWorstCaseCostUsd`: `maxTokens` as the completion count -- the
 * API's own hard ceiling, so real usage can never exceed it -- and zero
 * assumed cache hit, the more expensive case). This bounds the damage of the
 * one call that tips the cap over to at most that call's own worst-case
 * cost, and hard-blocks every call after it, rather than promising the cap
 * can never be crossed by even a single cent -- which no pre-flight check
 * over an unknown-until-complete response could honestly promise.
 */
const DEFAULT_CAP_USD = 1.0;

function configuredCapUsd(): number {
  const raw = process.env.AI_GATEWAY_SERVER_KEY_SPEND_CAP_USD;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP_USD;
}

export interface SpendCapCheck {
  allowed: boolean;
  /** Present only when `allowed` is false -- safe to surface as-is; names no key, no user. */
  reason?: string;
  capUsd: number;
  spentUsd: number;
  estimatedCallUsd: number;
}

export async function checkSpendCap(
  keySource: KeySource,
  model: string,
  promptChars: number,
  maxTokens: number,
  opts: { store?: UsageStore; capUsdOverride?: number; at?: Date } = {},
): Promise<SpendCapCheck> {
  if (keySource !== "server") {
    return { allowed: true, capUsd: Number.POSITIVE_INFINITY, spentUsd: 0, estimatedCallUsd: 0 };
  }
  const store = opts.store ?? getDefaultUsageStore();
  const capUsd = opts.capUsdOverride ?? configuredCapUsd();
  const spentUsd = await store.totalServerKeySpendUsd();
  const estimatedCallUsd = estimateWorstCaseCostUsd(model, promptChars, maxTokens, opts.at);
  const projected = spentUsd + estimatedCallUsd;
  if (projected > capUsd) {
    return {
      allowed: false,
      reason:
        `The shared AI budget cap has been reached ($${spentUsd.toFixed(4)} spent so far; ` +
        `this call could cost up to ~$${estimatedCallUsd.toFixed(4)} more, which would exceed the ` +
        `$${capUsd.toFixed(2)} cap). This feature is unavailable until the cap is raised or the ` +
        `underlying balance is topped up.`,
      capUsd,
      spentUsd,
      estimatedCallUsd,
    };
  }
  return { allowed: true, capUsd, spentUsd, estimatedCallUsd };
}
