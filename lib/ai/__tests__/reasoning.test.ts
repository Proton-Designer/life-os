import { describe, expect, it } from "vitest";
import { planReasoning, sendsReasoningEffort, HEADROOM_FULL_REASONING_TOKENS, HEADROOM_MINIMAL_REASONING_TOKENS } from "../reasoning";

describe("planReasoning(minimal): each provider's REAL floor, verified per model", () => {
  it.each([
    ["openai", "gpt-6-luna", { wireEffort: "none", disableThinking: false, reasoningOff: true, headroomTokens: 0 }],
    ["xai", "grok-4.3", { wireEffort: "none", disableThinking: false, reasoningOff: true, headroomTokens: 0 }],
    ["moonshot", "kimi-k2.6", { wireEffort: undefined, disableThinking: true, reasoningOff: true, headroomTokens: 0 }],
    ["anthropic", "claude-haiku-5-5", { wireEffort: "low", disableThinking: true, reasoningOff: true, headroomTokens: 0 }],
    ["google", "gemini-3.5-flash-lite", { wireEffort: "minimal", disableThinking: false, reasoningOff: false, headroomTokens: HEADROOM_MINIMAL_REASONING_TOKENS }],
  ] as const)("%s %s", (provider, model, expected) => {
    expect(planReasoning(provider, model, "minimal")).toEqual(expected);
  });

  it.each([
    ["openai", "gpt-6-astra"], // low..max, no none
    ["openai", "gpt-6.1-sol"],
    ["xai", "grok-4.7"], // reasoning cannot be disabled
    ["moonshot", "kimi-k3"], // always thinks
    ["anthropic", "claude-opus-5-5"], // thinking cannot be disabled
    ["anthropic", "claude-sonnet-5-5"],
    ["google", "gemini-2.5-pro"],
    ["openai", "some-future-model"], // unknown ids never get a guessed value
  ] as const)("%s %s has no verified 'off': falls back to low, full headroom, thinking left on", (provider, model) => {
    expect(planReasoning(provider, model, "minimal")).toEqual({ wireEffort: "low", disableThinking: false, reasoningOff: false, headroomTokens: HEADROOM_FULL_REASONING_TOKENS });
  });

  it("every other effort level is passed through unchanged with full headroom (existing callers see no difference)", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(planReasoning("openai", "gpt-6-luna", effort)).toMatchObject({ wireEffort: effort, disableThinking: false, reasoningOff: false });
    }
  });
});

describe("sendsReasoningEffort: only where the field is documented", () => {
  it("OpenAI always, xAI grok-4.x, Kimi K3 only; never Kimi K2.x, Claude, Gemini or DeepSeek", () => {
    expect(sendsReasoningEffort("openai", "gpt-6-luna")).toBe(true);
    expect(sendsReasoningEffort("xai", "grok-4.3")).toBe(true);
    expect(sendsReasoningEffort("xai", "grok-build-0.1")).toBe(false);
    expect(sendsReasoningEffort("moonshot", "kimi-k3")).toBe(true);
    expect(sendsReasoningEffort("moonshot", "kimi-k2.6")).toBe(false);
    expect(sendsReasoningEffort("anthropic", "claude-haiku-5-5")).toBe(false);
    expect(sendsReasoningEffort("google", "gemini-3.5-flash-lite")).toBe(false);
  });
});
