import "server-only";
import { PROVIDERS, type ProviderId } from "./providers";
import { openAiCompatibleChat, type OpenAiCompatibleChatOpts } from "./adapters/openai-compatible";
import type { ChatResult } from "./adapters/types";

export type { ChatResult } from "./adapters/types";

/**
 * The multi-provider dispatcher (2026-09-14, slice 3). Every caller of
 * `chat()` keeps the exact same signature and behavior it had when this
 * file WAS the DeepSeek-only OpenAI-wire client — that implementation
 * moved verbatim to adapters/openai-compatible.ts (see that file's own
 * header), and this function now just routes to whichever adapter speaks
 * `PROVIDERS[provider].wireProtocol`.
 *
 * anthropic.ts/google.ts land in later slices; until then, routing a
 * non-openai-compatible provider here throws rather than silently doing
 * nothing — the same "fail loud on unimplemented" posture worker-stages.ts
 * already takes for an unregistered ingest stage (a 501, not a silent
 * 200). Nothing calls `chat()` with a non-deepseek provider yet
 * (`gatewayChat` still hardcodes `DEFAULT_PROVIDER`), so this branch is
 * unreachable in production today — a placeholder for the next slice, not
 * a live gap.
 */
export type ChatOpts = OpenAiCompatibleChatOpts;

export async function chat(
  provider: ProviderId,
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: ChatOpts = {},
): Promise<ChatResult> {
  const { wireProtocol, label } = PROVIDERS[provider];
  switch (wireProtocol) {
    case "openai-compatible":
      return openAiCompatibleChat(provider, apiKey, messages, opts);
    case "anthropic":
    case "google":
      throw new Error(`chat(): ${label} (wireProtocol "${wireProtocol}") isn't wired yet — its adapter lands in a later multi-provider slice.`);
  }
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
 * `thinking: false` is a no-op for non-DeepSeek openai-compatible providers
 * today (see adapters/openai-compatible.ts's own header, gap 1) and doesn't
 * apply to anthropic/google adapters at all once those land — each adapter
 * owns translating "verify cheaply" into its own equivalent.
 */
export async function verifyKey(provider: ProviderId, apiKey: string): Promise<ChatResult> {
  return chat(provider, apiKey, [{ role: "user", content: "Reply with the single word: ok" }], {
    maxTokens: 20,
    thinking: false,
  });
}
