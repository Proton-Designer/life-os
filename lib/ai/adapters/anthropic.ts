import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS } from "../providers";
import type { ChatResult } from "./types";
import type { UsageTokens } from "../pricing";

/**
 * Claude, via the official `@anthropic-ai/sdk` (v0.125.0, pinned) — required,
 * no OpenAI-compatible shim (the Lead's explicit instruction; Anthropic's
 * Messages API is not wire-compatible with chat/completions at all, see
 * below). Every field/param name in this file was checked against the
 * INSTALLED SDK's own types before being used, not assumed from general
 * Claude API familiarity — the Messages API shape has moved since Opus 4.6
 * in ways that would silently break a request built from memory (see the
 * two quirks below, both found reading node_modules/@anthropic-ai/sdk/
 * resources/messages/messages.d.ts directly).
 *
 * TWO REAL SHAPE DIFFERENCES FROM THE OTHER ADAPTERS, not just a different
 * transport:
 *
 * 1. NO "system" ROLE IN MESSAGES. The SDK's own doc comment is explicit:
 *    "there is no 'system' role for input messages in the Messages API" —
 *    a system prompt is the top-level `system` string param instead. Every
 *    other adapter in this codebase accepts the same generic
 *    `{role:"system"|"user", content}[]` shape (matching every existing
 *    caller's own prompt-building code) — this adapter is the one place
 *    that shape gets TRANSLATED: any `role:"system"` entries become the
 *    `system` param, `role:"user"` entries become `messages`.
 * 2. TEMPERATURE IS REJECTED, NOT JUST IGNORED. The installed types mark
 *    `temperature` `@deprecated`: "Models released after Claude Opus 4.6 do
 *    not support setting temperature. A value of 1.0 will be accepted for
 *    backwards compatibility, all other values will be rejected with a 400
 *    error." Opus 5/Haiku 4.5/Sonnet 5 are all post-4.6 — `opts.temperature`
 *    is never sent here, on purpose, not merely omitted for tidiness. A
 *    caller that actually needs temperature control on Claude has no lever
 *    here; none of today's callers ask for one.
 *
 * REASONING CONTROL is `output_config.effort` (the Lead's own note,
 * confirmed in the SDK's types — `OutputConfig.effort`), NOT the separate
 * `thinking` param: `thinking` still exists and still defaults to enabled
 * for Opus 5, but explicitly DISABLING it has documented failure modes per
 * the Lead, so this file never touches `thinking` at all — `effort: "low"`
 * is the lever for "make this call cheap/fast," leaving thinking at
 * whatever Claude's own default does with that effort level.
 *
 * NO ASSISTANT PREFILL (the Lead's note): every caller in this codebase
 * already only ever sends `system`/`user` messages, never a trailing
 * `assistant` message to prime the response — so the 400 this would
 * otherwise cause structurally can't happen from any current call site.
 *
 * maxRetries: 0 — same reasoning as openai-sdk.ts's identical setting: the
 * gateway (lib/ai/gateway.ts's withRetry) already owns retry; stacking the
 * SDK's own default retries under it would multiply a failing call's
 * wall-clock time past what BUG-1's skip-vs-fail math assumes one call
 * costs.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

export interface AnthropicChatOpts {
  maxTokens?: number;
  /** NEVER sent — see this file's own header, quirk 2. Accepted for signature parity with the other adapters' opts; silently ignored. */
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  /** Translated to `output_config.effort` — see this file's own header for why this, not `thinking`. */
  effort?: "low" | "medium" | "high";
}

function splitMessages(messages: { role: "system" | "user"; content: string }[]): {
  system: string | undefined;
  userMessages: Anthropic.MessageParam[];
} {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const userMessages: Anthropic.MessageParam[] = messages
    .filter((m) => m.role === "user")
    .map((m) => ({ role: "user" as const, content: m.content }));
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, userMessages };
}

function parseUsage(usage: Anthropic.Usage): UsageTokens {
  return {
    promptTokens: usage.input_tokens,
    cachedPromptTokens: usage.cache_read_input_tokens ?? 0,
    completionTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
  };
}

/**
 * Maps the SDK's typed exceptions to the gateway's errorKind enum — same
 * discipline as openai-sdk.ts's classifyError, confirmed against the
 * installed SDK's own error.d.ts (identical class hierarchy shape to the
 * openai package's, both APIError subclasses per HTTP status).
 */
function classifyError(e: unknown): { message: string; errorKind: ChatResult["errorKind"] } {
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return { message: "The request timed out.", errorKind: "timeout" };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { message: "Couldn't reach Claude.", errorKind: "network" };
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { message: "That key was rejected. Check it's still active.", errorKind: "auth" };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { message: "Claude says you're out of quota or rate-limited.", errorKind: "rate_limited" };
  }
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.UnprocessableEntityError || e instanceof Anthropic.NotFoundError) {
    return { message: "That request was rejected — this is a problem on our side, not with your key.", errorKind: "bad_request" };
  }
  if (e instanceof Anthropic.InternalServerError) {
    return { message: "Claude returned a server error.", errorKind: "server_error" };
  }
  if (e instanceof Anthropic.APIError) {
    return { message: "Claude returned an error.", errorKind: "server_error" };
  }
  return { message: "Couldn't reach Claude.", errorKind: "network" };
}

export async function anthropicChat(
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: AnthropicChatOpts = {},
): Promise<ChatResult> {
  const model = opts.model ?? PROVIDERS.anthropic.defaultModel;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs,
    // Requirement #1 (the Lead) -- see this file's own header.
    maxRetries: 0,
  });
  const { system, userMessages } = splitMessages(messages);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    messages: userMessages,
    max_tokens: opts.maxTokens ?? 300,
    stream: false,
  };
  if (system !== undefined) params.system = system;
  if (opts.effort) params.output_config = { effort: opts.effort };
  // temperature deliberately never set -- see this file's own header, quirk 2.

  try {
    const message = await client.messages.create(params);
    const usage = parseUsage(message.usage);
    const modelUsed = message.model;
    const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    const content = textBlock?.text;
    if (!content) {
      const hadThinking = message.content.some((block) => block.type === "thinking" || block.type === "redacted_thinking");
      return {
        ok: false,
        message: hadThinking
          ? "Claude spent its whole reply budget on internal reasoning and never wrote an answer. Try again with more room to reply."
          : "Claude returned an empty response.",
        usage,
        modelUsed,
        errorKind: "empty_content",
      };
    }
    return { ok: true, content, usage, modelUsed };
  } catch (e) {
    const { message, errorKind } = classifyError(e);
    return { ok: false, message, errorKind };
  }
}
