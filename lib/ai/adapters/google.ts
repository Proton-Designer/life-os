import "server-only";
import { GoogleGenAI, ApiError, ThinkingLevel, type HttpOptions as GoogleHttpOptions } from "@google/genai";
import { PROVIDERS } from "../providers";
import type { ChatResult } from "./types";
import type { UsageTokens } from "../pricing";
import { planReasoning, type ReasoningEffort } from "../reasoning";

/**
 * Gemini, via the official `@google/genai` SDK (v2.22.0, pinned) — the
 * Lead's required package. Every field/param name here was checked against
 * the installed SDK's own bundled types
 * (node_modules/@google/genai/dist/genai.d.ts) before being used, same
 * discipline as openai-sdk.ts/anthropic.ts.
 *
 * SHAPE DIFFERENCES FROM THE OTHER ADAPTERS:
 *
 * 1. `contents`, NOT `messages`. Gemini's `generateContent` takes a single
 *    `contents` value (a string for the single-turn case every caller in
 *    this codebase needs) plus a separate `config.systemInstruction` —
 *    same "no system role inline" shape Claude has, different field names.
 *    Like anthropic.ts, this adapter translates the codebase's generic
 *    `{role:"system"|"user", content}[]` shape rather than exposing
 *    Gemini's own shape to callers.
 * 2. REASONING CONTROL is `config.thinkingConfig.thinkingLevel`
 *    ('LOW'|'MEDIUM'|'HIGH', confirmed in the SDK's `ThinkingLevel` enum) —
 *    maps directly from the gateway's normalized `effort` option, no
 *    translation table needed (the enum values ARE low/medium/high).
 * 3. ERROR SHAPE IS NOT A CLASS-PER-STATUS-CODE HIERARCHY like the openai/
 *    anthropic packages. `ApiError` is ONE class carrying a numeric
 *    `status` field — this adapter classifies by reading `error.status`
 *    directly rather than by `instanceof` against a family of status-
 *    specific classes, because the SDK genuinely doesn't have one. Client-
 *    side transport failures (`ConnectionError`, `RequestTimeoutError`, ...)
 *    ARE a real class hierarchy (`HTTPClientError` subclasses) and ARE
 *    classified by `instanceof`, same as the other adapters — see
 *    classifyError's own comment for exactly which is which.
 *
 * NO RETRIES: `httpOptions.retryOptions.attempts: 1` — the SDK's own docs
 * say "0 or 1... means no retries" and that the default (when unset) is 5.
 * Verified this setting actually has effect, not just documented intent:
 * a red-check against a mocked 429 confirmed `attempts: 1` produces exactly
 * 1 fetch call, while `attempts: 5` produces more than 1 (2, in that run --
 * timing-sensitive, but unambiguously more than 1, proving the setting is
 * real and observable). Left EXPLICIT rather than relying on whatever the
 * true default resolves to in production. Same reasoning as openai-sdk.ts/
 * anthropic.ts's `maxRetries: 0`: the gateway already owns retry, and
 * stacking the SDK's own would multiply a failing call's wall-clock time
 * past what BUG-1's skip-vs-fail math assumes one call costs.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

// ThinkingLevel is a real TS enum, not a string-literal union -- its
// members must be referenced by name (ThinkingLevel.LOW), even though the
// underlying values happen to be the same strings the gateway's `effort`
// option already uses.
const EFFORT_TO_THINKING_LEVEL: Record<"minimal" | "low" | "medium" | "high", ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export interface GoogleChatOpts {
  maxTokens?: number;
  /** Gemini genuinely supports temperature (unlike Claude's post-4.6 rejection) — sent when given. */
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  /** Maps to `thinkingConfig.thinkingLevel` -- see this file's own header, quirk 2. "minimal" becomes MINIMAL only on models that document it (3.5 Flash-Lite, 3.6 Flash, ...); elsewhere LOW. There is no "off" level on any Gemini 3 model. */
  effort?: ReasoningEffort;
  /** Ask for JSON back (`responseMimeType: application/json`). */
  json?: boolean;
}

function splitMessages(messages: { role: "system" | "user"; content: string }[]): {
  systemInstruction: string | undefined;
  userContent: string;
} {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const userParts = messages.filter((m) => m.role === "user").map((m) => m.content);
  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    // Every current caller sends exactly one user message; joined with a
    // blank line in the (currently unreached) case of more than one,
    // rather than silently dropping any but the first.
    userContent: userParts.join("\n\n"),
  };
}

function parseUsage(usage: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): UsageTokens | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokenCount ?? 0,
    cachedPromptTokens: usage.cachedContentTokenCount ?? 0,
    completionTokens: usage.candidatesTokenCount ?? 0,
    reasoningTokens: usage.thoughtsTokenCount ?? 0,
  };
}

/**
 * See this file's own header, quirk 3: `ApiError` carries a raw `status`,
 * not a class-per-status hierarchy — classified by reading it directly.
 * Client-side transport failures ARE a real class hierarchy
 * (`HTTPClientError` subclasses), confirmed against the installed SDK's
 * own types, and classified by instanceof like the other two adapters.
 */
function classifyError(e: unknown): { message: string; errorKind: ChatResult["errorKind"] } {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) {
      return { message: "That key was rejected. Check it's still active.", errorKind: "auth" };
    }
    if (e.status === 429) {
      return { message: "Gemini says you're out of quota or rate-limited.", errorKind: "rate_limited" };
    }
    if (e.status === 400 || e.status === 404 || e.status === 422) {
      return { message: "That request was rejected — this is a problem on our side, not with your key.", errorKind: "bad_request" };
    }
    if (e.status >= 500) {
      return { message: "Gemini returned a server error.", errorKind: "server_error" };
    }
    return { message: "Gemini returned an error.", errorKind: "server_error" };
  }
  if (e instanceof Error && e.name === "RequestTimeoutError") {
    return { message: "The request timed out.", errorKind: "timeout" };
  }
  if (e instanceof Error && (e.name === "ConnectionError" || e.name === "RequestAbortedError" || e.name === "UnexpectedClientError" || e.name === "InvalidRequestError")) {
    // InvalidRequestError is a CLIENT-side (pre-flight) request-shape
    // failure -- e.g. a malformed config this adapter itself built wrong.
    // Filed under "network" (infrastructure-shaped, our side, not the
    // user's key) rather than "bad_request" (which BUG-1's skip logic
    // treats as content-shaped-adjacent): a malformed request from OUR
    // code affects every call identically and must never be silently
    // skipped past chunk-by-chunk.
    return { message: "Couldn't reach Gemini.", errorKind: "network" };
  }
  return { message: "Couldn't reach Gemini.", errorKind: "network" };
}

export async function googleChat(
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: GoogleChatOpts = {},
): Promise<ChatResult> {
  const model = opts.model ?? PROVIDERS.google.defaultModel;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const httpOptions: GoogleHttpOptions = {
    timeout: timeoutMs,
    // Requirement #1 (the Lead) -- see this file's own header.
    retryOptions: { attempts: 1 },
  };
  const client = new GoogleGenAI({ apiKey, httpOptions });
  const { systemInstruction, userContent } = splitMessages(messages);

  try {
    const response = await client.models.generateContent({
      model,
      contents: userContent,
      config: {
        maxOutputTokens: opts.maxTokens ?? 300,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(systemInstruction !== undefined ? { systemInstruction } : {}),
        ...(opts.effort ? { thinkingConfig: { thinkingLevel: EFFORT_TO_THINKING_LEVEL[planReasoning("google", model, opts.effort).wireEffort as "minimal" | "low" | "medium" | "high"] } } : {}),
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    });
    const usage = parseUsage(response.usageMetadata);
    const modelUsed = response.modelVersion;
    const content = response.text;
    if (!content) {
      const hadThoughts = (response.usageMetadata?.thoughtsTokenCount ?? 0) > 0;
      return {
        ok: false,
        message: hadThoughts
          ? "Gemini spent its whole reply budget on internal reasoning and never wrote an answer. Try again with more room to reply."
          : "Gemini returned an empty response.",
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
