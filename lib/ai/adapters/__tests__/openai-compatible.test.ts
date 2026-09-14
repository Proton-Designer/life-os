import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { openAiCompatibleChat } from "../openai-compatible";
import { PROVIDERS } from "../../providers";

/**
 * Multi-provider slice 3 (2026-09-14). This file proves the extracted
 * adapter is genuinely shared across all four openai-compatible providers
 * — not just DeepSeek, whose byte-for-byte behavior is already pinned by
 * lib/ai/__tests__/client.test.ts (unchanged, still green after the move).
 *
 * Per the Lead's explicit instruction: DeepSeek is the only provider this
 * team holds a real key for. These are CONTRACT tests against mocked HTTP
 * — request shape (right URL, right model id) and the shared error-
 * classification path — never a live call to OpenAI/Kimi/Grok.
 */
describe("openAiCompatibleChat -- multi-provider request shape", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ model: "echoed-model", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["deepseek", "https://api.deepseek.com/chat/completions", PROVIDERS.deepseek.defaultModel],
    ["openai", "https://api.openai.com/v1/chat/completions", PROVIDERS.openai.defaultModel],
    ["moonshot", "https://api.moonshot.ai/v1/chat/completions", PROVIDERS.moonshot.defaultModel],
    ["xai", "https://api.x.ai/v1/chat/completions", PROVIDERS.xai.defaultModel],
  ] as const)("%s calls its own endpoint with its own default model id", async (provider, expectedUrl, expectedModel) => {
    await openAiCompatibleChat(provider, "test-key", [{ role: "user", content: "hi" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(expectedUrl);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(expectedModel);
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer test-key");
  });

  it("a non-DeepSeek provider's response is classified through the SAME shared error-kind mapping (401 -> auth)", async () => {
    fetchMock.mockResolvedValue({ status: 401, ok: false, json: async () => ({}) });
    const result = await openAiCompatibleChat("openai", "bad-key", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("auth");
    expect(result.message).toMatch(/OpenAI/);
  });

  it("thinking is a no-op for non-DeepSeek providers today -- sent as an extra field, never asserted as read by anything on their side (see this adapter's own header, gap 1)", async () => {
    await openAiCompatibleChat("xai", "test-key", [{ role: "user", content: "hi" }], { thinking: false });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    // Still sent -- this test documents the KNOWN gap, not a claim that
    // xAI honors it. Fixing gap 1 (per-provider reasoning knob) is a later
    // slice's job, not silently reinterpreted here.
    expect(body.thinking).toEqual({ type: "disabled" });
  });
});
