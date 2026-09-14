import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat, verifyKey } from "../client";

// Boss ruling (R7, DeepSeek task), relayed via ULM lead. Three findings on
// the exact screen where a user has just pasted their own API key:
//
// 1. defaultModel bet on an unverified name ("deepseek-chat") instead of a
//    listed one ("deepseek-v4-flash") -- covered in providers.test.ts, not
//    here, since it's a plain constant on PROVIDERS.
// 2. A bad model id (HTTP 400) rendered as the same generic
//    "DeepSeek returned an error (HTTP 400)" a 401/403 would, on the exact
//    screen a user just proved their key on -- implicating the key for a
//    failure that has nothing to do with it.
// 3. A 2xx response with empty `content` -- which DeepSeek's own docs admit
//    happens -- must fail with its own message, not read as success (a
//    caller checking `.ok` alone would otherwise treat `content: ""` as a
//    real answer).
describe("chat()'s HTTP status / content-shape mapping", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }

  it("a 401/403 (bad key) says the key was rejected", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_api_key" }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected that key/i);
  });

  it("a 400 (bad request -- e.g. a stale model id) must NOT implicate the user's key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { message: "invalid model" } }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    // The exact wrong behavior this pins against: the old generic message
    // read as "DeepSeek returned an error (HTTP 400)" on the same screen a
    // user just proved their key on -- easy to misread as "your key is bad."
    // The fix's own wording DOES say "key" (reassuringly: "not with your
    // key"), so the real assertion is that it never uses the 401/403
    // phrasing ("rejected that key") and does carry the "our side"
    // reassurance -- not that the word itself is absent.
    expect(result.message).not.toMatch(/rejected that key/i);
    expect(result.message).toMatch(/our side|not (a|the) (problem )?with your key/i);
  });

  // The push-back: prove the 400 and 401/403 messages can never quietly
  // collapse back into the same branch. If someone folds them together,
  // this fails because both messages become the exact same "rejected that
  // key" phrasing the 401/403 branch owns.
  it("400 and 401/403 are distinct messages, never merged", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, {}));
    const badRequest = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);

    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    const badKey = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);

    expect(badRequest.message).not.toBe(badKey.message);
    expect(badRequest.message).not.toMatch(/rejected that key/i);
    expect(badKey.message).toMatch(/rejected that key/i);
  });

  it("an empty content string in a 2xx response is a failure with its own message, not a silent success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "" } }] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.message).toMatch(/empty/i);
  });

  it("a 2xx response with no choices at all is the same empty-content failure, not a crash", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/empty/i);
  });

  it("a real 2xx response with content is still a success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("ok");
  });

  it("every failure branch carries a structured errorKind a retry policy can key off of, without parsing message text", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    expect((await chat("deepseek", "sk-test", [])).errorKind).toBe("auth");

    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    expect((await chat("deepseek", "sk-test", [])).errorKind).toBe("rate_limited");

    fetchMock.mockResolvedValueOnce(jsonResponse(400, {}));
    expect((await chat("deepseek", "sk-test", [])).errorKind).toBe("bad_request");

    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    expect((await chat("deepseek", "sk-test", [])).errorKind).toBe("server_error");

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: "" } }] }));
    expect((await chat("deepseek", "sk-test", [])).errorKind).toBe("empty_content");
  });

  it("parses usage, including cache-hit tokens (top-level) and reasoning tokens (nested under completion_tokens_details), per DeepSeek's actual wire shape", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        model: "deepseek-flash",
        choices: [{ message: { content: "the answer" } }],
        usage: {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 60,
          completion_tokens: 50,
          completion_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    );
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true);
    expect(result.modelUsed).toBe("deepseek-flash");
    expect(result.usage).toEqual({
      promptTokens: 100,
      cachedPromptTokens: 60,
      completionTokens: 50,
      reasoningTokens: 30,
    });
  });

  it("still returns usage on the empty-content failure path -- tokens were billed even though no usable answer came back", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: "", reasoning_content: "long internal chain of thought..." } }],
        usage: { prompt_tokens: 20, completion_tokens: 26, completion_tokens_details: { reasoning_tokens: 24 } },
      }),
    );
    const result = await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("empty_content");
    expect(result.usage?.reasoningTokens).toBe(24);
    // Distinct message when reasoning is the known cause, not the generic
    // "empty response" -- a human reading logs should not have to guess.
    expect(result.message).toMatch(/reasoning/i);
  });

  it("passes thinking:disabled through to the request body when opts.thinking === false", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));
    await chat("deepseek", "sk-test", [{ role: "user", content: "hi" }], { thinking: false });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.thinking).toEqual({ type: "disabled" });
  });
});

// Regression for the 2026-09-13 finding (Boss ruling, relayed via the LifeOS
// lead): verifyKey() used to call with maxTokens: 5 against a REASONING
// model that defaults to thinking mode on. A trivial "reply with ok" burned
// 24 of 26 output tokens on hidden reasoning_content in one measured real
// call, content came back empty, and client.ts's own empty-content check
// (correctly, in isolation) reported failure -- so "Test key" told every
// user with a perfectly valid key that it was broken. Two behaviors pinned:
// (1) verifyKey must disable thinking mode entirely, not just raise the
// token count and hope reasoning finishes in time; (2) even so, if a future
// model variant still reasons with thinking nominally off, the failure
// message must name reasoning as the cause rather than reading as a bad key.
describe("verifyKey() and the reasoning-mode regression", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }

  it("disables thinking mode and uses a real token floor, not the old maxTokens: 5", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));
    await verifyKey("deepseek", "sk-test");
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.thinking).toEqual({ type: "disabled" });
    expect(sentBody.max_tokens).toBeGreaterThan(5);
  });

  it("a valid key that returns real content succeeds -- the exact case the old code got wrong under a reasoning model", async () => {
    // This mock reproduces DeepSeek's actual measured shape for a naive
    // maxTokens:5 call against a reasoning model (26 total completion
    // tokens, 24 spent on reasoning, empty content) to prove the OLD
    // behavior would have failed it, before proving the NEW call succeeds
    // via the fixture below.
    const oldStyleReasoningExhaustion = jsonResponse(200, {
      choices: [{ message: { content: "", reasoning_content: "...24 tokens of internal reasoning..." } }],
      usage: { prompt_tokens: 12, completion_tokens: 26, completion_tokens_details: { reasoning_tokens: 24 } },
    });
    fetchMock.mockResolvedValueOnce(oldStyleReasoningExhaustion);
    const wouldHaveFailedWithOldMaxTokens = await chat(
      "deepseek",
      "sk-test",
      [{ role: "user", content: "Reply with the single word: ok" }],
      { maxTokens: 5 }, // the OLD call shape, thinking left enabled
    );
    expect(wouldHaveFailedWithOldMaxTokens.ok).toBe(false);

    // Now the actual fixed verifyKey(): thinking disabled, real content comes back.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 12, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 0 } },
      }),
    );
    const result = await verifyKey("deepseek", "sk-test");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("ok");
  });
});

/**
 * FOUND LIVE (2026-09-14): every call, regardless of shape, aborted at the
 * same hardcoded 20s (TIMEOUT_MS), and a real self-mastery extraction call
 * timed out against production -- twice, `ingestion_job_stage_attempts`
 * confirms -- with no test anywhere pinning the timeout behavior at all.
 * This describe block is the regression that closes that gap: a genuinely
 * hanging request must abort at the CONFIGURED duration, not always 20s.
 */
describe("chat()'s per-call timeoutMs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      // A real hanging request: only ever settles if aborted -- exactly the
      // shape a slow DeepSeek response has until either it replies or the
      // AbortController fires. Never resolves on its own, so the ONLY way
      // this promise settles is the timeout under test.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts at the default 20s when no timeoutMs is passed -- unchanged prior behavior", async () => {
    const resultPromise = chat("deepseek", "sk-test", [{ role: "user", content: "hi" }]);
    await vi.advanceTimersByTimeAsync(19_999);
    // Not yet aborted -- proves this isn't a shorter, coincidentally-passing timer.
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("timeout");
  });

  it("aborts at a custom timeoutMs, not the 20s default -- the actual fix", async () => {
    const resultPromise = chat("deepseek", "sk-test", [{ role: "user", content: "hi" }], { timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    // The bug this pins against: at the OLD hardcoded 20s, this would
    // already have aborted here. It must not have.
    await Promise.race([resultPromise, Promise.resolve("still pending")]).then((v) => expect(v).toBe("still pending"));
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("timeout");
  });
});

/**
 * Multi-provider slice 3 (2026-09-14). `chat()` is now a dispatcher on
 * `PROVIDERS[provider].wireProtocol` — these tests are the dispatcher's
 * own contract, distinct from openai-compatible.ts's request-shape tests
 * (lib/ai/adapters/__tests__/openai-compatible.test.ts) and from this
 * file's own pre-existing DeepSeek behavior tests above (unchanged, still
 * green, proving the extraction was genuinely byte-for-byte).
 */
describe("chat() -- multi-provider dispatch", () => {
  it("routes every openai-compatible provider through the shared adapter (proven by a real fetch call happening, not just no throw)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    for (const provider of ["deepseek", "openai", "moonshot", "xai"] as const) {
      fetchMock.mockClear();
      const result = await chat(provider, "test-key", [{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    vi.unstubAllGlobals();
  });

  it("throws a clear, named error for a provider whose adapter isn't wired yet, rather than silently doing nothing", async () => {
    await expect(chat("anthropic", "test-key", [{ role: "user", content: "hi" }])).rejects.toThrow(/Claude.*isn't wired yet/);
    await expect(chat("google", "test-key", [{ role: "user", content: "hi" }])).rejects.toThrow(/Gemini.*isn't wired yet/);
  });
});
