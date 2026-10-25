import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeUsageStore } from "./fake-usage-store";

/**
 * Book ingestion calls gatewayChat the same way for every user, whatever provider they chose: a [system, user] pair, a
 * small visible-output budget (MAX_TOKENS_EXTRACT = 600), tier "cheap", thinking off, and a prompt that demands strict JSON.
 * This pins what each provider's request and response look like for THAT call (recorded response shapes, mocked at the HTTP
 * layer, no live calls), because the budget models are reasoning models and the adapters were written for short chat calls:
 *   - system prompt placement (own field for Claude and Gemini, a message for the OpenAI-wire providers);
 *   - the token-limit field name each endpoint expects;
 *   - JSON mode where the provider has one (OpenAI / Kimi / Grok response_format, Gemini responseMimeType);
 *   - reasoning headroom: a reasoning model's hidden thinking is billed against the SAME limit as the answer, so 600 visible
 *     tokens must not become an empty reply or half a JSON object;
 *   - DeepSeek's request is byte-for-byte what it always was.
 */

const resolveApiKeyWithSourceMock = vi.fn();
vi.mock("@/lib/ai/resolve-key", () => ({ resolveApiKeyWithSource: (...a: unknown[]) => resolveApiKeyWithSourceMock(...a) }));
vi.mock("@/lib/ai/preferences", () => ({ getAiPreference: vi.fn(async () => ({ ok: true, preference: { provider: "deepseek", modelTier: "cheap" } })) }));
vi.mock("@/lib/ai/monthly-spend-cap", () => ({ checkMonthlySpendCap: vi.fn(async () => ({ allowed: true, capUsd: 10, spentUsd: 0, monthKey: "2026-10" })) }));

const { gatewayChat } = await import("../gateway");
const { REASONING_HEADROOM_TOKENS } = await import("../gateway");
const { HEADROOM_MINIMAL_REASONING_TOKENS } = await import("../reasoning");

const NOW = new Date("2026-10-25T12:00:00Z");
const client = {} as unknown as SupabaseClient;
const MESSAGES = [
  { role: "system" as const, content: "You extract teachable lessons from book passages." },
  { role: "user" as const, content: 'Passage:\n"""..."""\nReturn ONLY strict JSON: {"lessons": []}' },
];
const INGESTION_CALL = { maxTokens: 600, thinking: false, effort: "minimal" as const, tier: "cheap" as const, json: true, usageStore: new FakeUsageStore(), now: NOW };

const LESSONS_JSON = '{"lessons":[{"title":"Use the two-minute rule","core_claim":"c","mechanism":"m","action_template":"a","provenance_quote":"q"}]}';

describe("ingestion's JSON call, per provider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("navigator", undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resolveApiKeyWithSourceMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const sentBody = () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  const run = (provider: "deepseek" | "openai" | "moonshot" | "xai" | "anthropic" | "google") => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-test-key-0123456789", source: "user" });
    return gatewayChat(client, "u1", "self_mastery_ingestion_extract_lessons", MESSAGES, { ...INGESTION_CALL, provider, usageStore: new FakeUsageStore() });
  };

  it("DeepSeek: unchanged -- max_tokens exactly 600, thinking disabled, system role in messages, NO response_format, no headroom", async () => {
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: LESSONS_JSON } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const result = await run("deepseek");
    expect(result.ok).toBe(true);
    const body = sentBody();
    expect(body.max_tokens).toBe(600);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[0]).toEqual({ role: "system", content: MESSAGES[0]!.content });
    expect(body.response_format).toBeUndefined();
  });

  it.each([
    ["openai", "max_completion_tokens", "https://api.openai.com/v1/chat/completions", { reasoning_effort: "none" }],
    ["moonshot", "max_tokens", "https://api.moonshot.ai/v1/chat/completions", { thinking: { type: "disabled" } }],
    ["xai", "max_tokens", "https://api.x.ai/v1/chat/completions", { reasoning_effort: "none" }],
  ] as const)("%s (its budget model can switch reasoning OFF): system message first, %s = exactly 600 (no headroom needed), JSON mode on, reasoning off on the wire", async (provider, tokenField, url, reasoning) => {
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: LESSONS_JSON } }], model: "echo", usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const result = await run(provider);
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe(url);
    const body = sentBody();
    expect(body.messages[0]).toEqual({ role: "system", content: MESSAGES[0]!.content });
    expect(body.messages[1].role).toBe("user");
    expect(body[tokenField]).toBe(600);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).toMatchObject(reasoning);
  });

  it("a provider/model that CANNOT switch reasoning off keeps the full headroom and the low floor (OpenAI gpt-6-astra, via an explicit capable-model call)", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-test-key-0123456789", source: "user" });
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: LESSONS_JSON } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    await gatewayChat(client, "u1", "self_mastery_ingestion_extract_lessons", MESSAGES, { ...INGESTION_CALL, provider: "openai", tier: "capable", usageStore: new FakeUsageStore() });
    const body = sentBody();
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(600 + REASONING_HEADROOM_TOKENS);
  });

  it("Claude (Haiku 5.5): system prompt in the top-level `system` field (never a message), thinking disabled and max_tokens 600, effort low, no JSON-mode field it does not have", async () => {
    fetchMock.mockResolvedValue(respond({ id: "m", model: "echo", content: [{ type: "text", text: LESSONS_JSON }], usage: { input_tokens: 10, output_tokens: 5 } }));
    const result = await run("anthropic");
    expect(result.ok).toBe(true);
    const body = sentBody();
    expect(body.system).toBe(MESSAGES[0]!.content);
    expect(body.messages).toEqual([{ role: "user", content: MESSAGES[1]!.content }]);
    expect(body.max_tokens).toBe(600); // Haiku 5.5 runs with thinking disabled: no headroom needed
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it("Gemini: systemInstruction + contents, maxOutputTokens with a small headroom, thinking MINIMAL, responseMimeType application/json", async () => {
    fetchMock.mockResolvedValue(respond({ candidates: [{ content: { parts: [{ text: LESSONS_JSON }], role: "model" }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, modelVersion: "echo" }));
    const result = await run("google");
    expect(result.ok).toBe(true);
    const body = sentBody();
    expect(body.systemInstruction.parts[0].text).toBe(MESSAGES[0]!.content);
    expect(body.contents[0].parts[0].text).toBe(MESSAGES[1]!.content);
    expect(body.generationConfig.maxOutputTokens).toBe(600 + HEADROOM_MINIMAL_REASONING_TOKENS); // minimal, not off: a little room
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
  });

  it("a call that does NOT ask for JSON (every other gateway caller) gets no JSON mode and no headroom on any provider", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-test-key-0123456789", source: "user" });
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    await gatewayChat(client, "u1", "answer_feedback", MESSAGES, { provider: "openai", tier: "cheap", maxTokens: 300, usageStore: new FakeUsageStore(), now: NOW });
    const body = sentBody();
    expect(body.max_completion_tokens).toBe(300);
    expect(body.response_format).toBeUndefined();
  });

  describe("recorded reply shapes the ingestion stage has to survive", () => {
    it("a reasoning model that spends the whole budget thinking is an empty_content failure (skippable), never a half answer: OpenAI, Claude, Gemini", async () => {
      fetchMock.mockResolvedValueOnce(respond({ choices: [{ message: { content: "", reasoning_content: "..." }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 2100, completion_tokens_details: { reasoning_tokens: 2100 } } }));
      expect(await run("openai")).toMatchObject({ ok: false, errorKind: "empty_content" });

      fetchMock.mockResolvedValueOnce(respond({ id: "m", model: "echo", content: [{ type: "thinking", thinking: "...", signature: "s" }], usage: { input_tokens: 10, output_tokens: 2100 } }));
      expect(await run("anthropic")).toMatchObject({ ok: false, errorKind: "empty_content" });

      fetchMock.mockResolvedValueOnce(respond({ candidates: [{ content: { parts: [], role: "model" }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 10, thoughtsTokenCount: 2100 } }));
      expect(await run("google")).toMatchObject({ ok: false, errorKind: "empty_content" });
    });

    it("reasoning tokens are read from each provider's own field so the cost log is right: OpenAI, Claude, Gemini", async () => {
      fetchMock.mockResolvedValueOnce(respond({ choices: [{ message: { content: LESSONS_JSON } }], usage: { prompt_tokens: 10, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 700 } } }));
      expect((await run("openai")).usage?.reasoningTokens).toBe(700);
      fetchMock.mockResolvedValueOnce(respond({ id: "m", model: "echo", content: [{ type: "text", text: LESSONS_JSON }], usage: { input_tokens: 10, output_tokens: 900, output_tokens_details: { thinking_tokens: 650 } } }));
      expect((await run("anthropic")).usage?.reasoningTokens).toBe(650);
      fetchMock.mockResolvedValueOnce(respond({ candidates: [{ content: { parts: [{ text: LESSONS_JSON }], role: "model" } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 200, thoughtsTokenCount: 600 } }));
      expect((await run("google")).usage?.reasoningTokens).toBe(600);
    });
  });
});
