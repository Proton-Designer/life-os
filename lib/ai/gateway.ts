import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat, type ChatResult } from "./client";
import { resolveApiKeyWithSource } from "./resolve-key";
import { PROVIDERS, type ModelTier, type ProviderId } from "./providers";
import { withRetry, type RetryOptions } from "./retry";
import { checkSpendCap } from "./spend-cap";
import { estimateMultiProviderCostUsd } from "./pricing";
import { recordUsage, type UsageStore } from "./usage-log";
import { getAiPreference } from "./preferences";
import { checkMonthlySpendCap } from "./monthly-spend-cap";

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
   * MULTI-PROVIDER, REVERSED 2026-09-15 (the Lead's fix): earlier same-day
   * versions of this file left "which provider did this user pick" to the
   * caller, on the theory that it kept the gateway free of a preferences-
   * table dependency. That theory failed 3 for 3 against real callers
   * (answer-feedback-actions.ts, syllabus-extraction.ts, deepseek-
   * provider.ts) -- none of them passed `provider`, so the whole
   * preference picker wrote a row nothing ever consumed. Correct by
   * construction now instead: when this is omitted, gatewayChat resolves
   * THIS CALL'S OWN userId's saved preference itself (getAiPreference,
   * lib/ai/preferences.ts) -- it already has `supabase`+`userId` in scope,
   * which is the one place every call already passes through. An explicit
   * `provider` still wins outright and skips the lookup (ingestion, which
   * must stay pinned to the book owner's preference at a FORCED tier
   * regardless of what tier they picked, still passes tier explicitly;
   * see `tier`'s own doc below).
   */
  provider?: ProviderId;
  /**
   * Same reversal as `provider` above, resolved from the SAME preference
   * lookup when omitted (one query serves both, not two). 'cheap' = the
   * resolved provider's own budget model; 'capable' = its flagship.
   * Ingestion (deepseek-provider.ts) passes this explicitly as "cheap" —
   * Addition A, the Lead: bulk book processing must NEVER ride a user's
   * chosen flagship tier, which would spend real money per book. That
   * explicit override wins regardless of what the user's own tier
   * preference says.
   */
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
  /** True only when THIS user's own monthly budget (lib/ai/monthly-spend-cap.ts) — separate from the shared-key `capBlocked` above — is why this call didn't happen. */
  monthlyCapBlocked?: boolean;
}

export async function gatewayChat(
  supabase: SupabaseClient,
  userId: string,
  feature: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: GatewayChatOptions = {},
): Promise<GatewayChatResult> {
  let provider = opts.provider;
  let tier = opts.tier;
  if (provider === undefined || tier === undefined) {
    // Only hit the preferences table when at least one of the two is
    // omitted — an explicit (provider, tier) pair (ingestion's forced
    // "cheap" alongside its book-owner-resolved provider, for example)
    // never needs this lookup at all, and never risks failing on it.
    const pref = await getAiPreference(supabase, userId);
    if (!pref.ok) {
      // FAIL CLOSED — see preferences.ts's own header. A failed read must
      // not quietly resolve to deepseek/cheap the way a genuinely absent
      // row does; that would reopen cross-provider fallback through a
      // side door. No adapter is called, nothing is logged (there is no
      // usage to record for a call that never had a provider to attempt).
      return { ok: false, message: pref.reason };
    }
    provider = provider ?? pref.preference.provider;
    tier = tier ?? pref.preference.modelTier;
  }

  const resolved = await resolveApiKeyWithSource(supabase, userId, provider);
  if (!resolved) {
    // NULL IS THE NORMAL RESULT (resolve-key.ts's own rule) — no key
    // configured for this user, nothing to log, nothing wrong.
    return { ok: false, message: "AI features aren't enabled for this account." };
  }

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

  // SEPARATE from the global cap just above: this user's OWN monthly
  // budget, regardless of key source (their own key still spends their own
  // money). See lib/ai/monthly-spend-cap.ts's own header for why this is a
  // distinct check rather than folded into checkSpendCap.
  const monthlyCheck = await checkMonthlySpendCap(supabase, userId, provider, model, promptChars, maxTokens, {
    store: opts.usageStore,
    at: opts.now,
  });
  if (!monthlyCheck.allowed) {
    return {
      ok: false,
      message: monthlyCheck.reason,
      keySource: resolved.source,
      monthlyCapBlocked: !monthlyCheck.contextFailure,
    };
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

export interface IngestionKeyCheck {
  /** Whether a real gatewayChat() call for this user's ingestion work would actually find a usable key. */
  usable: boolean;
  /**
   * The resolved provider's display label (PROVIDERS[x].label), for a
   * precise "no key" message ("Add a key for Claude..."). Absent only when
   * the preference read itself failed -- there is then no provider to name,
   * so the caller should show a generic message instead of guessing deepseek.
   */
  providerLabel?: string;
}

/**
 * Book ingestion's own upload-gate check (2026-09-15, the Lead's fix,
 * Addition A's sibling): `deepseek-provider.ts`'s `chatJson` omits
 * `provider` on every call, so it now resolves to the book OWNER's saved
 * preference (this file's own reversal, above) -- which means the upload
 * gate must check THAT SAME resolution, not assume DeepSeek. Before this,
 * `isIngestionAvailable()` (the driver-heartbeat check) was the only gate:
 * true whenever the poller was alive, regardless of whether the uploading
 * user actually had a usable key for whatever provider they'd chosen. A
 * user who switched their preference to Claude but never added a Claude key
 * could upload a book that would strand at every ingestion step forever --
 * the exact "processing forever" failure mode ingestion-availability.ts's
 * own header describes, just reached through the key side instead of the
 * driver side.
 *
 * Reuses `resolveApiKeyWithSource` (not a hand-rolled key lookup) so the
 * allowlist (`resolve-key.ts`'s `sharedKeyAllowed`) applies exactly as it
 * would on the real ingestion call -- a non-allowlisted user with no
 * DeepSeek key of their own must see "no key," never a false "usable"
 * because this check forgot the allowlist exists.
 *
 * FAILS CLOSED on a preference read failure, same posture as gatewayChat
 * itself: `usable: false` with no `providerLabel` (there is no resolved
 * provider to name), rather than guessing deepseek and telling a user their
 * upload will work when the actual gatewayChat call would refuse it too.
 */
export async function hasUsableIngestionKey(supabase: SupabaseClient, userId: string): Promise<IngestionKeyCheck> {
  const pref = await getAiPreference(supabase, userId);
  if (!pref.ok) return { usable: false };
  const resolved = await resolveApiKeyWithSource(supabase, userId, pref.preference.provider);
  return { usable: resolved !== null, providerLabel: PROVIDERS[pref.preference.provider].label };
}

/**
 * One shared wording for `hasUsableIngestionKey`'s two call sites
 * (self-mastery-library.tsx's button-hiding read, self-mastery-actions.ts's
 * `uploadBook` server refusal) — kept here rather than duplicated at each
 * site so the two can never drift apart.
 */
export function ingestionNoKeyMessage(providerLabel: string | undefined): string {
  return providerLabel
    ? `Add an API key for ${providerLabel} in Settings to process books.`
    : "Add an AI provider key in Settings to process books.";
}
