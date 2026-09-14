import "server-only";
import OpenAI from "openai";
import { PROVIDERS, type ProviderId } from "../providers";
import type { ChatResult } from "./types";
import type { UsageTokens } from "../pricing";

/**
 * The official `openai` npm SDK (v7.15.0, pinned), for OpenAI itself and
 * the two other OpenAI-wire-compatible providers whose exact request/
 * response quirks were NOT already proven against DeepSeek's raw-fetch
 * path (Kimi/Moonshot, Grok/xAI) — see the Lead's explicit instruction:
 * DeepSeek keeps its existing byte-for-byte raw-fetch path
 * (adapters/openai-compatible.ts) untouched; this file is for the OTHER
 * three, on the real SDK, so a wire-shape mismatch surfaces as a typed
 * compile error or a typed exception, never a silent malformed request.
 *
 * THE CONCRETE RISK THIS SIDESTEPS (the Lead's own example, verified
 * against the installed SDK's own types before writing this file):
 * OpenAI's current reasoning-model families reject `max_tokens` and
 * require `max_completion_tokens` instead (confirmed:
 * node_modules/openai/resources/chat/completions/completions.d.ts marks
 * `max_tokens` deprecated in favor of `max_completion_tokens`). A
 * DeepSeek-shaped request body sent to OpenAI would 400 for every user —
 * the SDK's typed params make that mismatch visible, but each provider
 * still needs its own small QUIRKS entry below; the SDK does not
 * automatically know which shape a given non-OpenAI endpoint wants.
 *
 * maxRetries: 0 on every client (the Lead's requirement #1) — the gateway
 * (lib/ai/gateway.ts's withRetry) already owns retry. The SDK's own
 * default is 2; stacking SDK retries under gateway retries would multiply
 * a failing call's wall-clock time (3 SDK attempts x gateway maxAttempts x
 * timeoutMs) well past what BUG-1's skip-vs-fail math assumes a single
 * call costs, and would silently multiply spend on a call that's already
 * failing.
 *
 * ONLY OPENAI ITSELF IS EVEN PARTIALLY VERIFIED. Kimi's and xAI's exact
 * quirks (reasoning-effort param name, whether they accept
 * `max_completion_tokens` or only classic `max_tokens`) are NOT confirmed
 * against their own docs today — QUIRKS below defaults them to the
 * classic OpenAI-compatible shape (`max_tokens`, no reasoning-effort
 * param sent) rather than guessing a specific non-standard field name.
 * Verify before relying on reasoning-effort control for either.
 */

interface ProviderQuirks {
  /** Which token-limit param this endpoint expects. OpenAI moved to max_completion_tokens; Kimi/Moonshot and Grok/xAI are assumed to still accept the classic max_tokens shape (NOT independently verified — see this file's own header). */
  tokenLimitParam: "max_completion_tokens" | "max_tokens";
  /** Whether to send `temperature` at all. OpenAI's reasoning-model family handles it differently enough that omitting it entirely is the safe default (per the Lead's own caution) rather than guessing which values it tolerates. */
  sendTemperature: boolean;
  /** `reasoning_effort` is OpenAI's own confirmed param name (Shared.ReasoningEffort in the installed SDK's types). Unconfirmed for Kimi/xAI -- left false so this file never sends a param name it hasn't verified. */
  supportsReasoningEffort: boolean;
}

const QUIRKS: Record<"openai" | "moonshot" | "xai", ProviderQuirks> = {
  openai: { tokenLimitParam: "max_completion_tokens", sendTemperature: false, supportsReasoningEffort: true },
  moonshot: { tokenLimitParam: "max_tokens", sendTemperature: true, supportsReasoningEffort: false },
  xai: { tokenLimitParam: "max_tokens", sendTemperature: true, supportsReasoningEffort: false },
};

// Same default client.ts/openai-compatible.ts has always used for a short,
// interactive call -- unchanged so verifyKey()'s behavior doesn't shift
// for these three providers relative to DeepSeek's.
const DEFAULT_TIMEOUT_MS = 20_000;

export interface OpenAiSdkChatOpts {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  /** Normalized 3-level reasoning control, translated to `reasoning_effort` for providers whose QUIRKS entry confirms support -- silently unsent otherwise, never a guessed param name. */
  effort?: "low" | "medium" | "high";
}

function clientFor(provider: "openai" | "moonshot" | "xai", apiKey: string, timeoutMs: number): OpenAI {
  const { baseUrl } = PROVIDERS[provider];
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: timeoutMs,
    // Requirement #1 (the Lead) -- see this file's own header.
    maxRetries: 0,
  });
}

function parseUsage(usage: OpenAI.CompletionUsage | undefined): UsageTokens | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    // OpenAI's real cached-token field, per its own current types --
    // DIFFERENT from DeepSeek's top-level `prompt_cache_hit_tokens`
    // (see adapters/openai-compatible.ts's own header, gap 2, which this
    // file closes for OpenAI specifically by using the real nested shape
    // rather than DeepSeek's field name).
    cachedPromptTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/**
 * Maps the SDK's own typed exceptions to the gateway's errorKind enum --
 * never string-matching `error.message`, same discipline client.ts's raw-
 * fetch adapter already follows for HTTP status codes. Table confirmed
 * against node_modules/openai/core/error.d.ts (installed version 7.15.0)
 * before writing this, not assumed from memory of an earlier SDK major.
 */
function classifyError(e: unknown): { message: string; errorKind: ChatResult["errorKind"] } {
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return { message: "The request timed out.", errorKind: "timeout" };
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return { message: "Couldn't reach the provider.", errorKind: "network" };
  }
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return { message: "That key was rejected. Check it's still active.", errorKind: "auth" };
  }
  if (e instanceof OpenAI.RateLimitError) {
    return { message: "The provider says you're out of quota or rate-limited.", errorKind: "rate_limited" };
  }
  if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.UnprocessableEntityError || e instanceof OpenAI.NotFoundError) {
    // NotFoundError (404) folded in here deliberately: for a chat
    // completions call this almost always means a wrong/retired model id
    // (a routing problem, not an auth problem) -- same bucket bad_request
    // already covers for DeepSeek's 400 (client.ts's own comment: "has
    // nothing to do with whether their key is valid").
    return { message: "That request was rejected — this is a problem on our side, not with your key.", errorKind: "bad_request" };
  }
  if (e instanceof OpenAI.InternalServerError) {
    return { message: "The provider returned a server error.", errorKind: "server_error" };
  }
  if (e instanceof OpenAI.APIError) {
    // Any other typed API error this table didn't name explicitly --
    // still a real HTTP failure from the provider, default to server_error
    // rather than mis-filing it as one of the more specific kinds above.
    return { message: "The provider returned an error.", errorKind: "server_error" };
  }
  return { message: "Couldn't reach the provider.", errorKind: "network" };
}

export async function openAiSdkChat(
  provider: "openai" | "moonshot" | "xai",
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: OpenAiSdkChatOpts = {},
): Promise<ChatResult> {
  const quirks = QUIRKS[provider];
  const { defaultModel } = PROVIDERS[provider];
  const model = opts.model ?? defaultModel;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = clientFor(provider, apiKey, timeoutMs);
  const maxTokens = opts.maxTokens ?? 300;

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    stream: false,
  };
  if (quirks.tokenLimitParam === "max_completion_tokens") {
    params.max_completion_tokens = maxTokens;
  } else {
    params.max_tokens = maxTokens;
  }
  if (quirks.sendTemperature) {
    params.temperature = opts.temperature ?? 0.2;
  }
  if (quirks.supportsReasoningEffort && opts.effort) {
    params.reasoning_effort = opts.effort;
  }

  try {
    const res = await client.chat.completions.create(params);
    const usage = parseUsage(res.usage);
    const modelUsed = res.model;
    const content = res.choices[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        message: "The provider returned an empty response.",
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
