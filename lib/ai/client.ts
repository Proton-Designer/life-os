import "server-only";
import type { ProviderId } from "./providers";
import { openAiCompatibleChat } from "./adapters/openai-compatible";
import { openAiSdkChat } from "./adapters/openai-sdk";
import { anthropicChat } from "./adapters/anthropic";
import { googleChat } from "./adapters/google";
import type { ChatResult } from "./adapters/types";

export type { ChatResult } from "./adapters/types";

/**
 * The multi-provider dispatcher (2026-09-14, slices 3-4). Every caller of
 * `chat()` keeps the exact same signature it had when this file WAS the
 * DeepSeek-only OpenAI-wire client.
 *
 * TWO DIFFERENT IMPLEMENTATIONS SHARE `wireProtocol: "openai-compatible"`,
 * by design (the Lead's explicit ruling, slice 4): DeepSeek alone keeps its
 * original raw-fetch path (adapters/openai-compatible.ts — moved verbatim
 * in slice 3, confirmed byte-for-byte by client.test.ts passing unchanged)
 * because "leave the existing DeepSeek path byte-for-byte working" and
 * "OpenAI/Kimi/Grok on the real `openai` SDK" are both real requirements
 * that can't both be satisfied by ONE shared implementation — DeepSeek was
 * never proven against the SDK's own request shape, and the other three
 * were never proven against the raw-fetch one. `provider === "deepseek"`
 * is the one place that split is made explicit, rather than hidden behind
 * a wireProtocol value that would imply more uniformity than actually
 * exists between the four.
 *
 * anthropic.ts (slice 5) and google.ts (slice 6, this one) each get their
 * own branch here rather than folding into either "openai-compatible"
 * path: neither Claude's Messages API nor Gemini's `generateContent` is
 * wire-compatible with chat/completions (no "system" role, `contents`
 * instead of `messages`, different error shapes entirely). All 6
 * providers are now wired — `chat()` no longer has an unreachable branch
 * for any registered ProviderId.
 */
export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  /** Override PROVIDERS[provider].defaultModel — e.g. the gateway's tiering. */
  model?: string;
  timeoutMs?: number;
  /** DeepSeek-only (adapters/openai-compatible.ts's own header) — ignored by every other adapter. */
  thinking?: boolean;
  /** Normalized 3-level reasoning control for the SDK-backed adapters (openai-sdk.ts, and anthropic.ts once it lands) — ignored by DeepSeek's raw-fetch path, which keeps its own `thinking` boolean instead. */
  effort?: "low" | "medium" | "high";
}

export async function chat(
  provider: ProviderId,
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: ChatOpts = {},
): Promise<ChatResult> {
  if (provider === "deepseek") {
    return openAiCompatibleChat(provider, apiKey, messages, opts);
  }
  if (provider === "openai" || provider === "moonshot" || provider === "xai") {
    return openAiSdkChat(provider, apiKey, messages, opts);
  }
  if (provider === "anthropic") {
    return anthropicChat(apiKey, messages, opts);
  }
  // provider === "google" -- the last case; TypeScript's exhaustiveness
  // over ProviderId (all 6 branches above + this) means there is no
  // "unimplemented" fallthrough left to guard, unlike slices 3-5.
  return googleChat(apiKey, messages, opts);
}

/**
 * The cheapest call that proves a key works, used by "Test key" in Settings.
 *
 * Verifying at save time matters more than it looks: without it, a mistyped key
 * is stored happily and the only symptom is that an optional feature quietly
 * never appears — indistinguishable from not having enabled it. That is the
 * silent-absence failure this codebase has hit repeatedly.
 *
 * FIXED 2026-09-13 (E1, LLM gateway build): this used to call with
 * `maxTokens: 5` and DeepSeek's reasoning models by default spend most (in
 * one measured case, 24 of 26) of a small token budget on hidden
 * `reasoning_content` before ever reaching the visible answer -- so a
 * perfectly valid key reliably came back as "Test key" FAILED, telling users
 * their working key was broken. Two independent fixes, not one relying on
 * the other: (1) `thinking: false` skips reasoning mode entirely for this
 * call -- it doesn't need reasoning, it needs one word back -- which is the
 * real fix; (2) `maxTokens` raised from 5 to 20 as a floor regardless, in
 * case a future model variant reasons even with thinking nominally off.
 * `lib/ai/__tests__/client.test.ts` pins a reasoning-heavy mock response
 * (large `reasoning_content`, tiny/absent `content`, at the OLD maxTokens)
 * as a regression test.
 *
 * `thinking: false` applies to DeepSeek only (its raw-fetch adapter's own
 * field). `effort: "low"` is its sibling for the SDK-backed adapters
 * (openai-sdk.ts's OpenAI entry; anthropic.ts's Claude entry, translated to
 * `output_config.effort`, never disabling `thinking` itself -- see that
 * file's own header for why; Kimi/xAI don't confirm reasoning-effort
 * support yet, so it's silently unsent for them) — each provider gets
 * whichever of the two its own adapter reads, the other is simply ignored.
 *
 * `model` (multi-provider, 2026-09-14, the Lead's requirement): omitted,
 * this verifies PROVIDERS[provider].defaultModel (the budget model) as it
 * always has. api-key-actions.ts passes the user's actually-SELECTED
 * catalog model tier explicitly instead, so "Test key"/"Connect" verify
 * the key AND that exact model id TOGETHER — a retired or mistyped model
 * string surfaces here, once, at setup, naming the model, rather than
 * failing silently inside every real feature later.
 */
export async function verifyKey(provider: ProviderId, apiKey: string, model?: string): Promise<ChatResult> {
  return chat(provider, apiKey, [{ role: "user", content: "Reply with the single word: ok" }], {
    model,
    maxTokens: 20,
    thinking: false,
    effort: "low",
  });
}
