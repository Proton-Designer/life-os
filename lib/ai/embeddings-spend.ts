import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMonthlySpendCapContext, monthWindowUtc } from "./monthly-spend-cap";
import { getDefaultUsageStore, type UsageStore } from "./usage-log";
import { estimateWorstCaseEmbeddingCostUsd, type EmbeddingProvider } from "./embeddings-pricing";

/**
 * Pre-flight monthly-spend gate for embeddings (P2-13). Mirrors
 * `checkTranscriptionSpendCap`'s (lib/ai/transcription-spend.ts) own shape
 * and reasoning exactly, itself mirroring `checkMonthlySpendCap`'s
 * discriminated result and fail-closed posture (lib/ai/monthly-spend-cap.ts)
 * -- built as its OWN function because `checkMonthlySpendCap` estimates
 * cost from `promptChars`/`maxTokens`, which assumes a completion side an
 * embeddings call doesn't have. Reuses only the two building blocks that
 * don't assume a chat call: `resolveMonthlySpendCapContext` (the user's own
 * ceiling + timezone) and `UsageStore.monthlySpendUsdForUser` (what's
 * already been spent this month, across EVERY feature -- embeddings spend
 * counts toward the SAME ceiling as chat and transcription spend, never a
 * separate pool a user could blow past without realizing, per Sonnet ENG 1's
 * explicit guidance). Coordinated with ENG 1 (lib/ai owner) and the Lead
 * before writing this rather than editing monthly-spend-cap.ts itself.
 */

export type EmbeddingSpendResult =
  | { allowed: true; capUsd: number; spentUsd: number; estimatedCostUsd: number }
  | { allowed: false; reason: string; capUsd: number; spentUsd: number; estimatedCostUsd: number; contextFailure?: false }
  | { allowed: false; reason: string; contextFailure: true };

export async function checkEmbeddingSpendCap(
  supabase: SupabaseClient,
  userId: string,
  provider: EmbeddingProvider,
  texts: string[],
  opts: { store?: UsageStore; at?: Date } = {},
): Promise<EmbeddingSpendResult> {
  const context = await resolveMonthlySpendCapContext(supabase, userId);
  if (!context.ok) {
    // Fail CLOSED -- same reasoning as checkMonthlySpendCap's own header: a
    // cap that couldn't even be resolved is a failure to answer the
    // question, not a safe default to fall back on.
    return { allowed: false, reason: context.reason, contextFailure: true };
  }

  const store = opts.store ?? getDefaultUsageStore();
  const now = opts.at ?? new Date();
  const { startUtc, endUtc } = monthWindowUtc(now, context.timezone);
  const spentUsd = await store.monthlySpendUsdForUser(userId, startUtc, endUtc);
  const estimatedCostUsd = estimateWorstCaseEmbeddingCostUsd(provider, texts);
  const projected = spentUsd + estimatedCostUsd;

  if (projected > context.capUsd) {
    return {
      allowed: false,
      reason:
        `You've reached your AI budget this month ($${spentUsd.toFixed(2)} of $${context.capUsd.toFixed(2)} spent; ` +
        `this embedding call could cost up to ~$${estimatedCostUsd.toFixed(4)} more). It resets at the start of ` +
        `next month, or you can raise the ceiling in Settings.`,
      capUsd: context.capUsd,
      spentUsd,
      estimatedCostUsd,
    };
  }
  return { allowed: true, capUsd: context.capUsd, spentUsd, estimatedCostUsd };
}
