import "server-only";
import { PROVIDERS, type ProviderId } from "./providers";
import type { UsageTokens } from "./pricing";

/**
 * A minimal OpenAI-wire chat client. DeepSeek speaks that protocol, so this is
 * a fetch and a type — no SDK, no dependency to keep current, and adding a
 * second compatible provider is a base URL.
 *
 * Every function here can fail and every caller must treat failure as "this
 * enhancement is unavailable right now", never as an error the user has to
 * resolve. The features behind this are optional by construction.
 */

export interface ChatResult {
  ok: boolean;
  content?: string;
  /** Safe to show a user. Never contains the key. */
  message?: string;
  /**
   * Token accounting for THIS call, present whenever the API returned a
   * `usage` object at all (even on some failure paths, e.g. an empty-content
   * 2xx still burned tokens and must still be logged/billed). Absent only
   * when the request never reached a point where DeepSeek could report
   * usage (network failure, timeout, 4xx before a completion was attempted).
   * `lib/ai/usage-log.ts` is the only intended consumer of this field.
   */
  usage?: UsageTokens;
  /** The model DeepSeek actually served the request with (its own echo). */
  modelUsed?: string;
  /**
   * A structured failure classifier for `lib/ai/retry.ts` to key off of --
   * deliberately NOT inferred by pattern-matching `message` text (a user-
   * facing string is free to reword; a retry policy must not silently break
   * when it does). Undefined when `ok: true`.
   */
  errorKind?: "auth" | "rate_limited" | "bad_request" | "server_error" | "empty_content" | "timeout" | "network";
}

const TIMEOUT_MS = 20_000;

interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  /** Override PROVIDERS[provider].defaultModel — e.g. the gateway's tiering. */
  model?: string;
  /**
   * Explicitly enable/disable DeepSeek's "thinking" (reasoning) mode
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
  const cachedPromptTokens = typeof u.prompt_cache_hit_tokens === "number" ? u.prompt_cache_hit_tokens : 0;
  // Reasoning tokens ARE nested, mirroring the OpenAI-compatible shape:
  // usage.completion_tokens_details.reasoning_tokens. Billed as ordinary
  // output tokens by DeepSeek (see lib/ai/pricing.ts) — recorded separately
  // here purely for cost-per-useful-token visibility, not a separate price.
  const details = u.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = typeof details?.reasoning_tokens === "number" ? details.reasoning_tokens : 0;
  return { promptTokens, cachedPromptTokens, completionTokens, reasoningTokens };
}

export async function chat(
  provider: ProviderId,
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: ChatOpts = {},
): Promise<ChatResult> {
  const { baseUrl, defaultModel, label } = PROVIDERS[provider];
  const model = opts.model ?? defaultModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
 */
export async function verifyKey(provider: ProviderId, apiKey: string): Promise<ChatResult> {
  return chat(provider, apiKey, [{ role: "user", content: "Reply with the single word: ok" }], {
    maxTokens: 20,
    thinking: false,
  });
}
