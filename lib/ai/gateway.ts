import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat, type ChatResult } from "./client";
import { DEFAULT_PROVIDER, resolveApiKeyWithSource } from "./resolve-key";
import { PROVIDERS, type ModelTier, type ProviderId } from "./providers";
import { withRetry, type RetryOptions } from "./retry";
import { checkSpendCap } from "./spend-cap";
import { estimateMultiProviderCostUsd } from "./pricing";
import { recordUsage, type UsageStore } from "./usage-log";

/**
 * THE gateway. Every AI-backed feature should call `gatewayChat()` instead
 * of `lib/ai/client.ts`'s `chat()` directly — this is where tiering, the
 * spend cap, structured retry, and usage logging all actually happen. A
 * feature that calls `chat()` directly gets none of them, the same way a
 * feature that queried Postgres directly instead of through RLS would get
 * none of this codebase's tenancy guarantees.
 *
 * DEGRADE TO NOTHING BROKEN, NEVER A BROKEN UI (client.ts's own founding
 * rule, preserved here): every exit from this function is a normal
 * `ChatResult`-shaped value with `ok: false` and a safe `message` — no key,
 * a refused cap, every retry exhausted, and a genuine provider failure all
 * look the same to a caller: "this enhancement is unavailable right now."
 * None of them throw.
 */

export interface GatewayChatOptions {
  /**
   * Multi-provider (2026-09-14). Defaults to DEFAULT_PROVIDER (deepseek) --
   * every pre-existing caller that omits this gets its EXACT prior
   * behavior, unchanged: same provider, same key resolution, same pricing
   * function underneath (estimateMultiProviderCostUsd("deepseek", ...)
   * delegates straight to the untouched DeepSeek-only arithmetic). A
   * caller that wants a user's chosen provider passes it explicitly --
   * this file does not read user_ai_preferences itself; resolving "which
   * provider did this user pick" is the caller's job (e.g. a Settings-
   * aware wrapper), keeping the gateway itself free of a preferences-table
   * dependency.
   */
  provider?: ProviderId;
  /** 'cheap' (default) = each provider's own budget model, thinking off. 'capable' = its flagship, thinking on. Either can be overridden below. */
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  /** DeepSeek-only (adapters/openai-compatible.ts's own header) -- ignored by every other provider's adapter. Overrides the tier's thinking-mode default for DeepSeek specifically. */
  thinking?: boolean;
  /** Normalized 3-level reasoning control for the SDK-backed adapters (openai-sdk.ts's OpenAI entry, anthropic.ts, google.ts) -- ignored by DeepSeek's raw-fetch path, which reads `thinking` instead. See client.ts's ChatOpts for which provider reads which. */
  effort?: "low" | "medium" | "high";
  /**
   * Overrides client.ts's TIMEOUT_MS default (20s) for this call. Found
   * necessary live, 2026-09-14: self-mastery's ingestion extraction calls
   * (larger chunks, up to 1000 output tokens) timed out at 20s in
   * production — see deepseek-provider.ts's own call sites for the values
   * chosen and why. Every OTHER caller (answer feedback, verifyKey, etc.)
   * omits this and keeps the unchanged 20s default; this is additive, not
   * a global timeout change.
   */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Test seam — an in-memory FakeUsageStore in every gateway test, never Supabase. */
  usageStore?: UsageStore;
  /** Test seam for the spend cap; production always uses the env-configured cap. */
  capUsdOverride?: number;
  /** Test seam for peak/off-peak pricing and the cap's time-sensitive estimate. */
  now?: Date;
}

export interface GatewayChatResult extends ChatResult {
  /** Whose balance this call drew on — absent when no key was available at all. */
  keySource?: "user" | "server";
  /** Total attempts made, including the first (see lib/ai/retry.ts). Absent when no call was attempted at all (no key, or cap refusal). */
  attempts?: number;
  /** What this call was billed at, our own estimate from the response's own usage — 0 when no call was made. */
  costUsd?: number;
  /** True only when the spend cap itself is why this call didn't happen — lets a caller distinguish "AI is off" from "AI ran out of shared budget" if it ever wants to. */
  capBlocked?: boolean;
}

export async function gatewayChat(
  supabase: SupabaseClient,
  userId: string,
  feature: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: GatewayChatOptions = {},
): Promise<GatewayChatResult> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const resolved = await resolveApiKeyWithSource(supabase, userId, provider);
  if (!resolved) {
    // NULL IS THE NORMAL RESULT (resolve-key.ts's own rule) — no key
    // configured for this user, nothing to log, nothing wrong.
    return { ok: false, message: "AI features aren't enabled for this account." };
  }

  const tier = opts.tier ?? "cheap";
  const model = PROVIDERS[provider].models[tier];
  const thinking = opts.thinking ?? tier === "capable";
  // Same tier-driven default posture as `thinking` above, generalized to
  // every SDK-backed adapter: a caller that hasn't thought about effort
  // gets a sensible default from the tier it already chose, not "no
  // reasoning control at all" (openai-sdk.ts/anthropic.ts/google.ts all
  // silently no-op an absent `effort`, same as `thinking` being absent for
  // DeepSeek -- see each adapter's own header).
  const effort = opts.effort ?? (tier === "capable" ? "high" : "low");
  const maxTokens = opts.maxTokens ?? 300;
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  const capCheck = await checkSpendCap(resolved.source, model, promptChars, maxTokens, {
    store: opts.usageStore,
    capUsdOverride: opts.capUsdOverride,
    at: opts.now,
    provider,
  });
  if (!capCheck.allowed) {
    // No call is made and nothing is logged — there is no usage to record
    // for a call that never reached the provider. The cap having refused IS
    // the fact worth knowing; `capBlocked` carries it without needing a log row.
    return { ok: false, message: capCheck.reason, keySource: resolved.source, capBlocked: true };
  }

  const { result, attempts } = await withRetry(
    () =>
      chat(provider, resolved.key, messages, {
        maxTokens,
        temperature: opts.temperature,
        model,
        thinking,
        effort,
        timeoutMs: opts.timeoutMs,
      }),
    opts.retry,
  );

  const tokens = result.usage ?? { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  const costUsd = result.usage ? estimateMultiProviderCostUsd(provider, model, tokens, opts.now) : 0;

  // Logged regardless of ok/failure whenever a real call was attempted (the
  // cap-refused early return above is the ONLY path that skips this) —
  // an empty-content 2xx still billed real tokens and must still show up in
  // the running total the NEXT call's cap check reads.
  await recordUsage(
    {
      userId,
      feature,
      provider,
      model,
      keySource: resolved.source,
      promptText: messages.map((m) => m.content).join("\n\n"),
      tokens,
      costUsd,
      succeeded: result.ok,
      retryCount: attempts - 1,
    },
    opts.usageStore,
  );

  return { ...result, keySource: resolved.source, attempts, costUsd };
}
