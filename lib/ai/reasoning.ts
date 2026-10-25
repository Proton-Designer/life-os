import type { ProviderId } from "./providers";

/**
 * "How little should this call think?" translated per provider AND model.
 *
 * The gateway's effort scale is minimal | low | medium | high. `minimal` means "as little hidden reasoning as this provider's
 * model genuinely allows", used by bulk structured-extraction calls (book ingestion) where reasoning is wasted money. What that
 * is differs by provider and even by model, and a wrong guess is a 400 for every user, so EVERY entry below was read from the
 * provider's own docs on 2026-10-25 and anything not verified falls back to "low" (the lowest level every reasoning model
 * accepts) or to sending nothing:
 *
 *   OpenAI   gpt-6-luna: reasoning none|low|medium|high|xhigh|max -> `reasoning_effort: "none"` (truly off).
 *            every other model (gpt-6.1-sol, gpt-6-astra: low..max, no none) -> "low".
 *   xAI      grok-4.3: model page "supports none (no reasoning at all), low, medium, high" -> `reasoning_effort: "none"`.
 *            grok-4.5/4.6/4.7: reasoning "cannot be disabled", low is the floor -> "low". Param is `reasoning_effort`.
 *   Kimi     kimi-k2.6: `thinking: {type: "disabled"}` (documented: thinking is on by default and can be disabled).
 *            kimi-k3 / k3.1: always think, no disable; `reasoning_effort: "low"` is the documented floor.
 *   Claude   claude-haiku-5-5: effort low..max, and `thinking: {type: "disabled"}` is accepted at effort high or below.
 *            other Claude 5.x models: thinking cannot be disabled (Opus 5.5 / Sonnet 5.5) -> effort "low".
 *   Gemini   gemini-3.5-flash-lite / 3.6-flash / 3-flash-preview: thinkingLevel minimal|low|medium|high; there is no "off",
 *            minimal is the floor (and the 3.5 Flash-Lite default). Other models -> "low".
 *   DeepSeek its own raw path is controlled by `thinking`, not effort; it never reads this.
 *
 * `reasoningOff` = the provider will not bill hidden reasoning against the output limit (so no headroom is needed);
 * `headroomTokens` = how much extra output limit a JSON call should be given for whatever reasoning remains.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** What an adapter should put on the wire. `wireEffort` undefined = send no effort parameter at all. */
export interface ReasoningPlan {
  wireEffort?: "none" | "minimal" | "low" | "medium" | "high";
  /** Send the provider's explicit "turn thinking off" switch (Claude `thinking: disabled`, Kimi K2.6 `thinking: {type: disabled}`). */
  disableThinking: boolean;
  reasoningOff: boolean;
  headroomTokens: number;
}

export const HEADROOM_FULL_REASONING_TOKENS = 1500; // a model that still reasons at "low"
export const HEADROOM_MINIMAL_REASONING_TOKENS = 500; // Gemini's minimal level: little thinking, but not none

const GEMINI_MINIMAL_MODELS = new Set(["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-robotics-er-2-preview"]);

/** Providers/models whose request takes a `reasoning_effort` field, verified. Everything else is sent no effort (Kimi K2.x, unknown ids). */
export function sendsReasoningEffort(provider: ProviderId, model: string): boolean {
  if (provider === "openai") return true;
  if (provider === "xai") return /^grok-4\./.test(model);
  if (provider === "moonshot") return /^kimi-k3/.test(model);
  return false;
}

export function planReasoning(provider: ProviderId, model: string, requested: ReasoningEffort): ReasoningPlan {
  const regular = (): ReasoningPlan => ({
    wireEffort: requested === "minimal" ? "low" : requested,
    disableThinking: false,
    reasoningOff: false,
    headroomTokens: HEADROOM_FULL_REASONING_TOKENS,
  });
  if (requested !== "minimal") return regular();

  switch (provider) {
    case "openai":
      return model === "gpt-6-luna"
        ? { wireEffort: "none", disableThinking: false, reasoningOff: true, headroomTokens: 0 }
        : regular();
    case "xai":
      return model === "grok-4.3"
        ? { wireEffort: "none", disableThinking: false, reasoningOff: true, headroomTokens: 0 }
        : regular();
    case "moonshot":
      return /^kimi-k2\.6/.test(model)
        ? { wireEffort: undefined, disableThinking: true, reasoningOff: true, headroomTokens: 0 }
        : regular();
    case "anthropic":
      return model === "claude-haiku-5-5"
        ? { wireEffort: "low", disableThinking: true, reasoningOff: true, headroomTokens: 0 }
        : regular();
    case "google":
      return GEMINI_MINIMAL_MODELS.has(model)
        ? { wireEffort: "minimal", disableThinking: false, reasoningOff: false, headroomTokens: HEADROOM_MINIMAL_REASONING_TOKENS }
        : regular();
    default:
      return regular();
  }
}
