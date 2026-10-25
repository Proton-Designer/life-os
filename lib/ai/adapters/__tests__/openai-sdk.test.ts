import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAiSdkChat } from "../openai-sdk";

/**
 * Multi-provider slice 4 (2026-09-14). Contract tests against the real
 * `openai` npm SDK (mocked at the HTTP layer, per the Lead's instruction —
 * no live calls to OpenAI/Kimi/xAI, the only provider we hold a real key
 * for is DeepSeek). A REAL `Response` object is used throughout, not a
 * minimal {status,ok,json} stand-in — the SDK reads more off the response
 * (headers) than a minimal mock provides; found live writing this suite
 * (client.test.ts's dispatcher test hit the same thing first).
 */
describe("openAiSdkChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("navigator", undefined); // see client.test.ts's dispatcher test for why
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const okBody = { choices: [{ message: { content: "ok" } }], model: "echoed-model", usage: { prompt_tokens: 10, completion_tokens: 5 } };

  describe("request shape per provider (QUIRKS)", () => {
    it("openai: uses max_completion_tokens, omits temperature, sends reasoning_effort when given", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }], { maxTokens: 50, temperature: 0.9, effort: "low" });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.max_completion_tokens).toBe(50);
      expect(body.max_tokens).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      expect(body.reasoning_effort).toBe("low");
    });

    it("moonshot: classic max_tokens + temperature, no reasoning_effort (unconfirmed support)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await openAiSdkChat("moonshot", "test-key", [{ role: "user", content: "hi" }], { maxTokens: 50, temperature: 0.5, effort: "high" });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.max_tokens).toBe(50);
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.temperature).toBe(0.5);
      // THE assertion this test exists for: effort must NOT be sent under
      // a guessed field name for a provider whose knob isn't confirmed.
      expect(body.reasoning_effort).toBeUndefined();
    });

    it("xai: same classic shape as moonshot, own endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await openAiSdkChat("xai", "test-key", [{ role: "user", content: "hi" }], { maxTokens: 50 });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.max_tokens).toBe(50);
    });

    it("sends the Authorization header with the given key", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await openAiSdkChat("openai", "sk-the-real-key", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      // The SDK builds a real Headers instance, not a plain object --
      // lowercased key, .get() not bracket access.
      expect(((init as RequestInit).headers as Headers).get("authorization")).toBe("Bearer sk-the-real-key");
    });

    it("defaults to the provider's own catalog default model when opts.model is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      const { PROVIDERS } = await import("../../providers");
      await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe(PROVIDERS.openai.defaultModel);
    });
  });

  describe("success and empty-content", () => {
    it("returns ok:true with the content, usage, and echoed model", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      expect(result).toMatchObject({ ok: true, content: "ok", modelUsed: "echoed-model" });
      expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
    });

    it("a 2xx with no content is ok:false, errorKind empty_content -- not a thrown exception", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: {} }] }));
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("empty_content");
    });

    it("reads OpenAI's real nested cache-token field (prompt_tokens_details.cached_tokens), NOT DeepSeek's top-level field name", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          ...okBody,
          usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } },
        }),
      );
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      expect(result.usage?.cachedPromptTokens).toBe(40);
    });
  });

  describe("error classification -- SDK typed exceptions mapped to the gateway's errorKind, not string-matched", () => {
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
      fetchMock.mockResolvedValue(jsonResponse(status, { error: { message: "provider says no" } }));
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(expectedKind);
    });

    it("a network-level fetch rejection (DNS, connection reset) classifies as network", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("network");
    });

    it("a timeout classifies as errorKind timeout, via the SDK's own timeout option (not a manual AbortController)", async () => {
      // The SDK aborts internally once `timeout` elapses; simulate that by
      // rejecting with the same AbortError shape fetch throws on a real abort.
      fetchMock.mockImplementation(() => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      });
      const result = await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }], { timeoutMs: 5 });
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("timeout");
    });
  });

  describe("maxRetries: 0 (the Lead's requirement #1)", () => {
    it("never retries a failing call itself -- exactly one fetch, even on a retryable-looking 429/500", async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: "rate limited" } }));
      await openAiSdkChat("openai", "test-key", [{ role: "user", content: "hi" }]);
      // The gateway (withRetry) owns retry, not the SDK -- stacking would
      // multiply BUG-1's per-call time budget and spend on a failing call.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("effort \"minimal\" -> each provider's real lowest reasoning (verified per model, falls back to low)", () => {
    const sentBody = () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    const run = (provider: "openai" | "moonshot" | "xai", model: string, effort: "minimal" | "low" | "high" = "minimal") => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      return openAiSdkChat(provider, "test-key", [{ role: "user", content: "hi" }], { model, maxTokens: 50, effort });
    };

    it("OpenAI gpt-6-luna: reasoning_effort none", async () => {
      await run("openai", "gpt-6-luna");
      expect(sentBody().reasoning_effort).toBe("none");
    });
    it("OpenAI models without a none level (gpt-6-astra, gpt-6.1-sol, unknown ids): low", async () => {
      for (const model of ["gpt-6-astra", "gpt-6.1-sol", "gpt-9-unknown"]) {
        fetchMock.mockReset();
        await run("openai", model);
        expect(sentBody().reasoning_effort, model).toBe("low");
      }
    });
    it("xAI grok-4.3: reasoning_effort none; grok-4.7 (reasoning cannot be disabled): low", async () => {
      await run("xai", "grok-4.3");
      expect(sentBody().reasoning_effort).toBe("none");
      fetchMock.mockReset();
      await run("xai", "grok-4.7");
      expect(sentBody().reasoning_effort).toBe("low");
    });
    it("xAI now receives a normal effort too (documented for grok-4.x), but a model that is not grok-4.x gets none", async () => {
      await run("xai", "grok-4.7", "high");
      expect(sentBody().reasoning_effort).toBe("high");
      fetchMock.mockReset();
      await run("xai", "grok-build-0.1", "high");
      expect(sentBody().reasoning_effort).toBeUndefined();
    });
    it("Kimi K2.6: thinking disabled through the documented `thinking` field, and NO reasoning_effort", async () => {
      await run("moonshot", "kimi-k2.6");
      expect(sentBody().thinking).toEqual({ type: "disabled" });
      expect(sentBody().reasoning_effort).toBeUndefined();
    });
    it("Kimi K3 always thinks: no disable switch, reasoning_effort low (its documented floor)", async () => {
      await run("moonshot", "kimi-k3");
      expect(sentBody().thinking).toBeUndefined();
      expect(sentBody().reasoning_effort).toBe("low");
    });
    it("Kimi K2.6 at a normal effort level is untouched (no thinking field, no effort)", async () => {
      await run("moonshot", "kimi-k2.6", "high");
      expect(sentBody().thinking).toBeUndefined();
      expect(sentBody().reasoning_effort).toBeUndefined();
    });
  });
});
