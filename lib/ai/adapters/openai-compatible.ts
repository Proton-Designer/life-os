import "server-only";
import { PROVIDERS, type ProviderId } from "../providers";
import type { UsageTokens } from "../pricing";
import type { ChatResult } from "./types";

/**
 * OpenAI-wire chat adapter — DeepSeek's original client.ts implementation,
 * MOVED HERE VERBATIM (2026-09-14, multi-provider slice 3) so it's
 * byte-for-byte diffable against its pre-move form: same function body,
 * same behavior, only the file and export name changed (was `chat()` in
 * client.ts, is `openAiCompatibleChat()` here). DeepSeek, OpenAI, Kimi/
 * Moonshot, and Grok/xAI all speak this same chat/completions wire shape
 * (`PROVIDERS[provider].wireProtocol === "openai-compatible"`) — see
 * providers.ts.
 *
 * NOT BEHAVIORALLY IDENTICAL PAST THE WIRE SHAPE, two known gaps, both
 * DELIBERATE for this slice (not fixed here — see the Lead's own note that
 * only DeepSeek is live-verified):
 *
 * 1. `thinking: {type:"disabled"|"enabled"}` is DeepSeek-specific wire
 *    syntax (per-provider reasoning-control fields differ — OpenAI's real
 *    knob is `reasoning_effort`, and Kimi's/Grok's aren't confirmed yet).
 *    Nothing calls this function with `opts.thinking` set for a
 *    non-DeepSeek provider today, so this field is inert (a harmless,
 *    unset optional field) for OpenAI/Kimi/Grok until a later slice adds
 *    the gateway's normalized `effort` option and per-provider translation.
 * 2. `parseUsage`'s `prompt_cache_hit_tokens` field name is DeepSeek's own
 *    (confirmed against their real API). OpenAI's documented equivalent is
 *    nested differently (`usage.prompt_tokens_details.cached_tokens`), and
 *    Kimi's/Grok's aren't confirmed at all — so `cachedPromptTokens` may
 *    silently read 0 for the other three providers until verified against
 *    a real response. This does NOT under-count total cost (promptTokens/
 *    completionTokens are unaffected), only the cache-discount portion —
 *    worth fixing before pricing.ts extends to bill them, not blocking
 *    this slice.
 */

// Same default every caller had before this move — unchanged for every
// existing short/interactive DeepSeek call (answer feedback, verifyKey).
const TIMEOUT_MS = 20_000;

export interface OpenAiCompatibleChatOpts {
  maxTokens?: number;
  temperature?: number;
  /** Override PROVIDERS[provider].defaultModel — e.g. the gateway's tiering. */
  model?: string;
  /** Overrides TIMEOUT_MS for this one call. See TIMEOUT_MS's own comment. */
  timeoutMs?: number;
  /**
   * DeepSeek-only in practice (see this file's own header, gap 1). Explicitly
   * enable/disable DeepSeek's "thinking" (reasoning) mode
   * (https://api-docs.deepseek.com/guides/thinking_mode). Both live DeepSeek
   * models default to thinking ENABLED when this is omitted — that default
   * is what broke `verifyKey()` (see below): a small `maxTokens` budget was
   * silently consumed almost entirely by hidden `reasoning_content`, leaving
   * an empty visible `content` that read as "the key doesn't work." Pass
   * `thinking: false` for any call that doesn't need reasoning — it also
   * bypasses the "temperature is ignored in thinking mode" surprise, since
   * thinking mode ignores `temperature`/`presence_penalty`/`frequency_penalty`
   * entirely (accepted, silently no-op'd — DeepSeek's own docs).
   */
  thinking?: boolean;
}

function parseUsage(usage: unknown): UsageTokens | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  // DeepSeek reports cache hit/miss as TOP-LEVEL usage fields, not nested.
  // See this file's own header, gap 2, for why this may under-report for
  // the other three openai-compatible providers.
  const cachedPromptTokens = typeof u.prompt_cache_hit_tokens === "number" ? u.prompt_cache_hit_tokens : 0;
  // Reasoning tokens ARE nested, mirroring the OpenAI-compatible shape:
  // usage.completion_tokens_details.reasoning_tokens. Billed as ordinary
  // output tokens by DeepSeek (see lib/ai/pricing.ts) — recorded separately
  // here purely for cost-per-useful-token visibility, not a separate price.
  const details = u.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = typeof details?.reasoning_tokens === "number" ? details.reasoning_tokens : 0;
  return { promptTokens, cachedPromptTokens, completionTokens, reasoningTokens };
}

export async function openAiCompatibleChat(
  provider: ProviderId,
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: OpenAiCompatibleChatOpts = {},
): Promise<ChatResult> {
  const { baseUrl, defaultModel, label } = PROVIDERS[provider];
  const model = opts.model ?? defaultModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: opts.maxTokens ?? 300,
      temperature: opts.temperature ?? 0.2,
      stream: false,
    };
    // Only sent when explicitly decided — omitting it entirely leaves
    // DeepSeek's own default (thinking enabled) in effect, which is the
    // right behavior for a caller that hasn't thought about this yet.
    if (opts.thinking === false) body.thinking = { type: "disabled" };
    if (opts.thinking === true) body.thinking = { type: "enabled" };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `${label} rejected that key. Check it's still active.`, errorKind: "auth" };
    }
    if (res.status === 429) {
      return { ok: false, message: `${label} says you're out of quota or rate-limited.`, errorKind: "rate_limited" };
    }
    if (res.status === 400) {
      // Deliberately NOT worded like the 401/403 message. This is the exact
      // screen a user has just pasted their own key and pressed "Test key"
      // on -- a bad request (e.g. a stale/renamed model id, malformed body)
      // has nothing to do with whether their key is valid, but the old
      // generic "HTTP 400" message read as if it might, and the first BYO-
      // key tester to hit it would reasonably go regenerate a perfectly
      // good key. Keep this branch distinct from 401/403 -- collapsing them
      // back together is exactly the regression lib/ai/__tests__/client.test.ts
      // pins against.
      return { ok: false, message: `That request to ${label} was rejected — this is a problem on our side, not with your key.`, errorKind: "bad_request" };
    }
    if (!res.ok) {
      // Deliberately not surfacing the provider's raw body: it can echo request
      // content, and on some providers that includes the Authorization header
      // in a debug field. Status is enough for a user to act on.
      return { ok: false, message: `${label} returned an error (HTTP ${res.status}).`, errorKind: "server_error" };
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
      usage?: unknown;
    };
    const usage = parseUsage(json.usage);
    const modelUsed = json.model;
    const message = json.choices?.[0]?.message;
    const content = message?.content;
    // A 2xx response with an empty (or missing) `content` is a failure, not
    // a success -- DeepSeek's own docs admit this happens, and it happens
    // MUCH more often on a reasoning model whose `reasoning_content` ate the
    // token budget before any visible answer was written. Still return
    // `usage` on this path: real tokens were billed even though no usable
    // content came back, and the usage log must reflect that spend.
    if (!content) {
      const hadReasoning = !!message?.reasoning_content;
      return {
        ok: false,
        message: hadReasoning
          ? `${label} spent its whole reply budget on internal reasoning and never wrote an answer. Try again with more room to reply.`
          : `${label} returned an empty response.`,
        usage,
        modelUsed,
        errorKind: "empty_content",
      };
    }
    return { ok: true, content, usage, modelUsed };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      return { ok: false, message: `${label} took too long to respond.`, errorKind: "timeout" };
    }
    return { ok: false, message: `Couldn't reach ${label}.`, errorKind: "network" };
  } finally {
    clearTimeout(timer);
  }
}
