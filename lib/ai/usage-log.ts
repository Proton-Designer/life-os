import "server-only";
import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { UsageTokens } from "./pricing";
import type { KeySource } from "./resolve-key";

/**
 * sha256 hex digest. NEVER store or forward the raw prompt text itself --
 * see migration 156's own header. This exists as its own exported function
 * (rather than inlined in `record()`) so a caller that wants to check "was
 * this exact prompt sent before" (e.g. a future cache-hit-rate report) can
 * compute the same hash without importing the whole usage-log module.
 */
export function hashPrompt(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export interface UsageLogEntry {
  userId: string;
  /** e.g. "answer_feedback", "ingestion_summarize" -- free text, see migration 156's header for why. */
  feature: string;
  provider: string;
  model: string;
  keySource: KeySource;
  /** Raw prompt text -- hashed internally via `hashPrompt`, never persisted or logged as-is. */
  promptText: string;
  tokens: UsageTokens;
  costUsd: number;
  succeeded: boolean;
  retryCount: number;
}

/**
 * The storage seam. `SupabaseUsageStore` is the real implementation; every
 * test in this codebase's gateway suite injects an in-memory fake instead --
 * the mock-provider-first testing strategy this build was asked for extends
 * to "zero DB" as well as "zero network": retry, tiering, cap enforcement
 * and cost accounting all need to be provable without a live Supabase
 * project, and an injectable store is what makes that possible without
 * mocking supabase-js's internals.
 */
export interface UsageStore {
  record(entry: UsageLogEntry): Promise<void>;
  /**
   * Sum of `cost_usd` for every 'server'-key-sourced row, across ALL users,
   * all time. This is the ONE number `lib/ai/spend-cap.ts` gates on -- see
   * its own header for why this is a lifetime total, not a daily window.
   */
  totalServerKeySpendUsd(): Promise<number>;
}

export class SupabaseUsageStore implements UsageStore {
  async record(entry: UsageLogEntry): Promise<void> {
    const client = createServiceRoleClient();
    const { error } = await client.from("ai_usage_log").insert({
      user_id: entry.userId,
      feature: entry.feature,
      provider: entry.provider,
      model: entry.model,
      key_source: entry.keySource,
      prompt_hash: hashPrompt(entry.promptText),
      input_tokens: entry.tokens.promptTokens,
      cached_input_tokens: entry.tokens.cachedPromptTokens,
      completion_tokens: entry.tokens.completionTokens,
      reasoning_tokens: entry.tokens.reasoningTokens,
      cost_usd: entry.costUsd,
      succeeded: entry.succeeded,
      retry_count: entry.retryCount,
    });
    // A failed WRITE to the usage log must never take down the feature that
    // triggered it -- same "degrade to nothing broken" posture as the rest
    // of lib/ai/. It DOES mean the spend cap's own total can under-count for
    // this one call; that direction (under-count, not over-count) is the
    // safer failure for a logging outage, and it is surfaced via
    // console.error so it's not silently invisible either.
    if (error) {
      console.error("ai_usage_log insert failed (feature continues; spend cap may under-count this call):", error.message);
    }
  }

  async totalServerKeySpendUsd(): Promise<number> {
    const client = createServiceRoleClient();
    // Client-side sum, not a SQL SUM(), deliberately: at the data volume a
    // $1.98 total account balance can ever produce (a few thousand rows at
    // the absolute most before the account is empty regardless), a second
    // Postgres function is not worth the migration surface. Revisit if this
    // table ever needs to answer the same question for a funded account.
    const { data, error } = await client.from("ai_usage_log").select("cost_usd").eq("key_source", "server");
    if (error || !data) {
      // CANNOT MEASURE must never read as "spent nothing" -- that would let
      // the spend cap wave every call through during an outage of the very
      // table it depends on. Fail toward the safer assumption: report
      // Infinity so the cap refuses everything until this is readable again.
      console.error("ai_usage_log spend total unreadable; failing closed on the spend cap:", error?.message);
      return Number.POSITIVE_INFINITY;
    }
    return data.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  }
}

let defaultStore: UsageStore | null = null;
/** Lazily constructed so importing this module never requires Supabase env vars at import time (tests never call this). */
export function getDefaultUsageStore(): UsageStore {
  if (!defaultStore) defaultStore = new SupabaseUsageStore();
  return defaultStore;
}

export async function recordUsage(entry: UsageLogEntry, store: UsageStore = getDefaultUsageStore()): Promise<void> {
  return store.record(entry);
}
