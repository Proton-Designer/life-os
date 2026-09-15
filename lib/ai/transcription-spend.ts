import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMonthlySpendCapContext } from "./monthly-spend-cap";
import { getDefaultUsageStore, type UsageStore } from "./usage-log";
import { monthWindowUtc } from "./monthly-spend-cap";
import { estimateWorstCaseTranscriptionCostUsd, type TranscriptionProvider } from "./transcription-pricing";

/**
 * Pre-flight monthly-spend gate for lecture transcription (P3-15). Mirrors
 * `checkMonthlySpendCap`'s own discriminated shape and fail-closed posture
 * (lib/ai/monthly-spend-cap.ts) exactly, but built as its OWN function
 * rather than a call into that one -- `checkMonthlySpendCap` estimates cost
 * from `promptChars`/`maxTokens`, which has no meaningful value for an
 * audio file. This file reuses only the two building blocks that don't
 * assume a chat call: `resolveMonthlySpendCapContext` (the user's own
 * ceiling + timezone) and `UsageStore.monthlySpendUsdForUser` (what's
 * already been spent this month, across every feature -- transcription
 * spend counts toward the SAME ceiling as chat spend, not a separate one).
 * Coordinated with Sonnet ENG 1 (lib/ai owner) and tracking-app-a9 before
 * writing this rather than editing monthly-spend-cap.ts itself.
 */

export type TranscriptionSpendResult =
  | { allowed: true; capUsd: number; spentUsd: number; estimatedCostUsd: number }
  | { allowed: false; reason: string; capUsd: number; spentUsd: number; estimatedCostUsd: number; contextFailure?: false }
  | { allowed: false; reason: string; contextFailure: true };

export async function checkTranscriptionSpendCap(
  supabase: SupabaseClient,
  userId: string,
  provider: TranscriptionProvider,
  sizeBytes: number,
  opts: { store?: UsageStore; at?: Date } = {},
): Promise<TranscriptionSpendResult> {
  const context = await resolveMonthlySpendCapContext(supabase, userId);
  if (!context.ok) {
    // Fail CLOSED -- same reasoning as checkMonthlySpendCap's own header:
    // a cap that couldn't even be resolved is a failure to answer the
    // question, not a safe default to fall back on.
    return { allowed: false, reason: context.reason, contextFailure: true };
  }

  const store = opts.store ?? getDefaultUsageStore();
  const now = opts.at ?? new Date();
  const { startUtc, endUtc } = monthWindowUtc(now, context.timezone);
  const spentUsd = await store.monthlySpendUsdForUser(userId, startUtc, endUtc);
  const estimatedCostUsd = estimateWorstCaseTranscriptionCostUsd(provider, sizeBytes);
  const projected = spentUsd + estimatedCostUsd;

  if (projected > context.capUsd) {
    return {
      allowed: false,
      reason:
        `You've reached your AI budget this month ($${spentUsd.toFixed(2)} of $${context.capUsd.toFixed(2)} spent; ` +
        `transcribing this file could cost up to ~$${estimatedCostUsd.toFixed(4)} more). It resets at the start of ` +
        `next month, or you can raise the ceiling in Settings.`,
      capUsd: context.capUsd,
      spentUsd,
      estimatedCostUsd,
    };
  }
  return { allowed: true, capUsd: context.capUsd, spentUsd, estimatedCostUsd };
}
