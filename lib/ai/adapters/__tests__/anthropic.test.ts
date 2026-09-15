import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { anthropicChat } from "../anthropic";

/**
 * Multi-provider slice 5 (2026-09-14). Contract tests against the real
 * `@anthropic-ai/sdk` (mocked at the HTTP layer — no live calls, same
 * posture as openai-sdk.test.ts). Every field name asserted here was
 * confirmed against the installed SDK's own types before anthropic.ts was
 * written (node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts),
 * not assumed from general Claude API familiarity.
 */
describe("anthropicChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("navigator", undefined); // same jsdom-vs-SDK gotcha as openai-sdk.test.ts
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const okBody = {
    id: "msg_1",
    model: "echoed-model",
    content: [{ type: "text", text: "ok", citations: null }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null, cache_creation: null, inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: null },
  };

  describe("request shape", () => {
    it('splits role:"system" messages into the top-level `system` param -- there is no "system" role in the Messages API', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await anthropicChat("test-key", [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hi" },
      ]);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.system).toBe("You are a helpful assistant.");
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
      // THE assertion this test exists for: a system-role entry must never
      // reach the messages array itself (the API would reject it).
      expect(body.messages.some((m: { role: string }) => m.role === "system")).toBe(false);
    });

    it("never sends temperature -- models after Opus 4.6 reject any value but 1.0 with a 400 (the installed SDK's own deprecation note)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await anthropicChat("test-key", [{ role: "user", content: "hi" }], { temperature: 0.7 });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.temperature).toBeUndefined();
    });

    it("translates effort to output_config.effort, never touches `thinking`", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await anthropicChat("test-key", [{ role: "user", content: "hi" }], { effort: "low" });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.output_config).toEqual({ effort: "low" });
      expect(body.thinking).toBeUndefined();
    });

    it("omits output_config entirely when no effort is given -- never a guessed default", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.output_config).toBeUndefined();
    });

    it("defaults to the catalog's own default model and sends max_tokens (not max_completion_tokens -- Claude kept the classic name)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      const { PROVIDERS } = await import("../../providers");
      await anthropicChat("test-key", [{ role: "user", content: "hi" }], { maxTokens: 42 });
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe(PROVIDERS.anthropic.defaultModel);
      expect(body.max_tokens).toBe(42);
    });

    it("sends the x-api-key header (Anthropic's own auth header, not a Bearer token)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, okBody));
      await anthropicChat("sk-ant-the-real-key", [{ role: "user", content: "hi" }]);
      const [, init] = fetchMock.mock.calls[0]!;
      expect(((init as RequestInit).headers as Headers).get("x-api-key")).toBe("sk-ant-the-real-key");
    });
  });

  describe("success and empty-content", () => {
    it("returns ok:true with the text block's content", async () => {
      const result = (fetchMock.mockResolvedValue(jsonResponse(200, okBody)), await anthropicChat("test-key", [{ role: "user", content: "hi" }]));
      expect(result).toMatchObject({ ok: true, content: "ok", modelUsed: "echoed-model" });
      expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 5 });
    });

    it("no text block at all (e.g. only a thinking block survived the token budget) -> ok:false, errorKind empty_content, names the reasoning-budget cause", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { ...okBody, content: [{ type: "thinking", thinking: "...", signature: "x" }] }),
      );
      const result = await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("empty_content");
      expect(result.message).toMatch(/reasoning/i);
    });

    it("reads output_tokens_details.thinking_tokens into reasoningTokens when present", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { ...okBody, usage: { ...okBody.usage, output_tokens_details: { thinking_tokens: 30 } } }),
      );
      const result = await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.usage?.reasoningTokens).toBe(30);
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
      [529, "server_error"],
    ] as const)("HTTP %i classifies as errorKind %s", async (status, expectedKind) => {
      fetchMock.mockResolvedValue(jsonResponse(status, { type: "error", error: { type: "api_error", message: "provider says no" } }));
      const result = await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(expectedKind);
    });

    it("a network-level fetch rejection classifies as network", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const result = await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe("network");
    });
  });

  describe("maxRetries: 0 (the Lead's requirement #1)", () => {
    it("never retries a failing call itself", async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } }));
      await anthropicChat("test-key", [{ role: "user", content: "hi" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
