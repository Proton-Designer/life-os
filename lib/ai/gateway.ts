import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat, type ChatResult } from "./client";
import { DEFAULT_PROVIDER, resolveApiKeyWithSource } from "./resolve-key";
import { PROVIDERS, type ModelTier } from "./providers";
import { withRetry, type RetryOptions } from "./retry";
import { checkSpendCap } from "./spend-cap";
import { estimateCostUsd } from "./pricing";
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
  /** 'cheap' (default) = deepseek-flash, thinking off. 'capable' = deepseek-v4-pro, thinking on. Either can be overridden below. */
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  /** Overrides the tier's thinking-mode default. */
  thinking?: boolean;
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
  const provider = DEFAULT_PROVIDER;
  const resolved = await resolveApiKeyWithSource(supabase, userId, provider);
  if (!resolved) {
    // NULL IS THE NORMAL RESULT (resolve-key.ts's own rule) — no key
    // configured for this user, nothing to log, nothing wrong.
    return { ok: false, message: "AI features aren't enabled for this account." };
  }

  const tier = opts.tier ?? "cheap";
  const model = PROVIDERS[provider].models[tier];
  const thinking = opts.thinking ?? tier === "capable";
  const maxTokens = opts.maxTokens ?? 300;
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  const capCheck = await checkSpendCap(resolved.source, model, promptChars, maxTokens, {
    store: opts.usageStore,
    capUsdOverride: opts.capUsdOverride,
    at: opts.now,
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
      }),
    opts.retry,
  );

  const tokens = result.usage ?? { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  const costUsd = result.usage ? estimateCostUsd(model, tokens, opts.now) : 0;

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
