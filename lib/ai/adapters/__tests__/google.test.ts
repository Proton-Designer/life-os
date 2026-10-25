import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { googleChat } from "../google";

/**
 * Multi-provider slice 6 (2026-09-14). Contract tests against the real
 * `@google/genai` SDK (mocked at the HTTP layer — no live calls). The
 * exact request/response shape asserted here (URL path, `x-goog-api-key`
 * header, `contents`/`systemInstruction`/`generationConfig` body shape) was
 * captured from a real SDK call against a mocked fetch before writing
 * these assertions, not guessed from REST docs — see this file's sibling
 * debug run in the commit history for the raw capture.
 */
describe("googleChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("navigator", undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const okBody = {
    candidates: [{ content: { parts: [{ text: "ok" }], role: "model" }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    modelVersion: "gemini-echo",
  };

  describe("request shape", () => {
    it('splits role:"system" into `systemInstruction`, role:"user" into `contents` -- not a shared "messages" array', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key", [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "hi" },
      ]);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toMatch(/generativelanguage\.googleapis\.com.*generateContent$/);
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.systemInstruction.parts[0].text).toBe("Be helpful.");
      expect(body.contents[0].parts[0].text).toBe("hi");
      expect(body.contents[0].role).toBe("user");
    });

    it("sends the x-goog-api-key header, NOT a Bearer Authorization header", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key-value", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      const headers = (init as RequestInit).headers as Headers;
      expect(headers.get("x-goog-api-key")).toBe("test-key-value");
      expect(headers.get("authorization")).toBeNull();
    });

    it("maps effort to thinkingConfig.thinkingLevel (uppercased, the real SDK enum value)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key", [{ role: "user", content: "hi" }], { effort: "medium" });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("MEDIUM");
    });

    it("omits thinkingConfig entirely when no effort is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.generationConfig.thinkingConfig).toBeUndefined();
    });

    it("sends maxOutputTokens (not max_tokens or max_completion_tokens -- Gemini's own field name)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key", [{ role: "user", content: "hi" }], { maxTokens: 77 });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.generationConfig.maxOutputTokens).toBe(77);
    });

    it("sends temperature when given -- unlike Claude, Gemini doesn't reject it", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await googleChat("test-key", [{ role: "user", content: "hi" }], { temperature: 0.4 });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.generationConfig.temperature).toBe(0.4);
    });

    it("defaults to the catalog's own default model in the URL path", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      const { PROVIDERS } = await import("../../providers");
      await googleChat("test-key", [{ role: "user", content: "hi" }]);
      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toContain(`/models/${PROVIDERS.google.defaultModel}:`);
    });
  });

  describe("success and empty-content", () => {
    it("returns ok:true with the response's .text getter output and usage mapped from usageMetadata", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      const result = await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result).toMatchObject({ ok: true, content: "ok", modelUsed: "gemini-echo" });
      expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
    });

    it("no text part at all -> ok:false, errorKind empty_content", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { ...okBody, candidates: [{ content: { parts: [], role: "model" }, finishReason: "STOP" }] }),
      );
      const result = await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("empty_content");
    });

    it("reads thoughtsTokenCount into reasoningTokens, and names the reasoning-budget cause when content is empty because of it", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ...okBody,
          candidates: [{ content: { parts: [], role: "model" }, finishReason: "STOP" }],
          usageMetadata: { ...okBody.usageMetadata, thoughtsTokenCount: 40 },
        }),
      );
      const result = await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.usage?.reasoningTokens).toBe(40);
      expect(result.message).toMatch(/reasoning/i);
    });
  });

  describe("error classification -- ApiError.status read directly (no per-status class hierarchy in this SDK), never string-matched", () => {
    it.each([
      [401, "auth"],
      [403, "auth"],
      [429, "rate_limited"],
      [400, "bad_request"],
      [404, "bad_request"],
      [422, "bad_request"],
      [500, "server_error"],
      [503, "server_error"],
    ] as const)("HTTP %i classifies as errorKind %s", async (status, expectedKind) => {
      fetchMock.mockResolvedValue(jsonResponse(status, { error: { code: status, message: "provider says no", status: "ERROR" } }));
      const result = await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(expectedKind);
    });

    it("a network-level fetch rejection classifies as network", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const result = await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("network");
    });
  });

  describe("no retries (the Lead's requirement #1, applied to this SDK's own retryOptions.attempts)", () => {
    it("never retries a failing call itself -- exactly one fetch, even on a retryable-looking 429/500 (attempts:1 is explicit, not relying on whatever the SDK's true default resolves to -- see google.ts's own header)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { error: { code: 429, message: "rate limited", status: "RESOURCE_EXHAUSTED" } }));
      await googleChat("test-key", [{ role: "user", content: "hi" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("effort \"minimal\"", () => {
    const level = () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).generationConfig.thinkingConfig.thinkingLevel;
    it("gemini-3.5-flash-lite (and 3.6-flash): thinkingLevel MINIMAL, its documented floor", async () => {
      for (const model of ["gemini-3.5-flash-lite", "gemini-3.6-flash"]) {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(jsonResponse(200, okBody));
        await googleChat("test-key", [{ role: "user", content: "hi" }], { model, effort: "minimal" });
        expect(level(), model).toBe("MINIMAL");
      }
    });
    it("models without a minimal level (gemini-2.5-pro, gemini-4-argon, unknown): LOW", async () => {
      for (const model of ["gemini-2.5-pro", "gemini-4-argon", "gemini-9-unknown"]) {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(jsonResponse(200, okBody));
        await googleChat("test-key", [{ role: "user", content: "hi" }], { model, effort: "minimal" });
        expect(level(), model).toBe("LOW");
      }
    });
  });
});
