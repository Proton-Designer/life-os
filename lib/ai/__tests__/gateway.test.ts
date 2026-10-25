import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeUsageStore } from "./fake-usage-store";

const resolveApiKeyWithSourceMock = vi.fn();
vi.mock("@/lib/ai/resolve-key", () => ({
  DEFAULT_PROVIDER: "deepseek",
  resolveApiKeyWithSource: (...args: unknown[]) => resolveApiKeyWithSourceMock(...args),
}));

// gatewayChat now resolves an omitted provider/tier from lib/ai/preferences
// itself (2026-09-15 reversal — see gateway.ts's own header). Mocked here,
// not left to hit the fake `{}` supabase client for real: `fakeClient` below
// has no `.from`, so an unmocked call would throw inside getAiPreference and
// every existing test that omits provider/tier would see gatewayChat fail
// closed instead of falling through to its old deepseek/cheap behavior.
// Default resolves to "no row" (deepseek/cheap) so every pre-existing test
// below keeps behaving exactly as it did before this reversal — the Lead's
// own instruction ("Updating those call sites is the right cost") is
// satisfied by this one shared default rather than editing every call site.
const getAiPreferenceMock = vi.fn();
vi.mock("@/lib/ai/preferences", () => ({
  getAiPreference: (...args: unknown[]) => getAiPreferenceMock(...args),
}));

// P2-01 (2026-09-15 overnight run): a second, independent cap gatewayChat
// now consults on every call, same reasoning as getAiPreferenceMock above --
// `fakeClient` has no `.from`, so an unmocked checkMonthlySpendCap would fail
// closed for real (see monthly-spend-cap.ts's own header) and block every
// pre-existing test below. Defaults to "allowed" so nothing above this line
// changes behavior; the "monthly spend cap" describe block below overrides
// it per-test to exercise the new gate itself.
const checkMonthlySpendCapMock = vi.fn();
vi.mock("@/lib/ai/monthly-spend-cap", () => ({
  checkMonthlySpendCap: (...args: unknown[]) => checkMonthlySpendCapMock(...args),
}));

// Imported AFTER the mocks are registered (vi.mock is hoisted by vitest regardless of
// literal position, but importing here keeps the file readable top-to-bottom).
const { gatewayChat, hasUsableIngestionKey, ingestionNoKeyMessage } = await import("../gateway");

const OFF_PEAK = new Date("2026-09-16T12:00:00Z");
const fakeClient = {} as unknown as SupabaseClient;

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe("gatewayChat()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resolveApiKeyWithSourceMock.mockReset();
    getAiPreferenceMock.mockReset();
    getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "deepseek", modelTier: "cheap" } });
    checkMonthlySpendCapMock.mockReset();
    checkMonthlySpendCapMock.mockResolvedValue({ allowed: true, capUsd: 10, spentUsd: 0, monthKey: "2026-09" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no key at all: degrades to absent, makes no network call, logs nothing", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue(null);
    const store = new FakeUsageStore();
    const result = await gatewayChat(fakeClient, "u1", "test_feature", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });
    expect(result.ok).toBe(false);
    expect(result.noKey).toBe(true); // a typed signal, so callers never have to match the message text
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.entries).toHaveLength(0);
  });

  it("defaults to the cheap tier: deepseek-flash, thinking disabled", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    const store = new FakeUsageStore();
    await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.model).toBe("deepseek-flash");
    expect(sentBody.thinking).toEqual({ type: "disabled" });
  });

  it("'capable' tier uses deepseek-v4-pro with thinking enabled by default", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    const store = new FakeUsageStore();
    await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { tier: "capable", usageStore: store, now: OFF_PEAK });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.model).toBe("deepseek-v4-pro");
    expect(sentBody.thinking).toEqual({ type: "enabled" });
  });

  it("an explicit thinking override wins over the tier default", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    const store = new FakeUsageStore();
    await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { tier: "cheap", thinking: true, usageStore: store, now: OFF_PEAK });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.thinking).toEqual({ type: "enabled" });
  });

  it("retries a rate-limited server-key call and logs the SUCCESSFUL final attempt with retry_count reflecting the retries", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, {
        model: "deepseek-flash",
        choices: [{ message: { content: "answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 0 } },
      }));
    const store = new FakeUsageStore();
    const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], {
      usageStore: store,
      retry: { sleep: async () => {} },
      now: OFF_PEAK,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.entries).toHaveLength(1); // one FINAL log entry, not one per attempt
    expect(store.entries[0].retryCount).toBe(1);
    expect(store.entries[0].succeeded).toBe(true);
  });

  it("never retries an auth failure, and still logs the single failed (zero-cost) attempt", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-bad-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    const store = new FakeUsageStore();
    const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], {
      usageStore: store,
      retry: { sleep: async () => {} },
      now: OFF_PEAK,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].succeeded).toBe(false);
    expect(store.entries[0].costUsd).toBe(0);
  });

  it("never retries empty_content -- one attempt, one logged (non-zero cost, since tokens WERE billed)", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, {
      model: "deepseek-flash",
      choices: [{ message: { content: "", reasoning_content: "..." } }],
      usage: { prompt_tokens: 10, completion_tokens: 26, completion_tokens_details: { reasoning_tokens: 24 } },
    }));
    const store = new FakeUsageStore();
    const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], {
      usageStore: store,
      retry: { sleep: async () => {} },
      now: OFF_PEAK,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].tokens.reasoningTokens).toBe(24);
    expect(store.entries[0].costUsd).toBeGreaterThan(0); // billed tokens, even though the call "failed"
  });

  it("computed cost matches lib/ai/pricing.ts's own arithmetic for the exact usage returned", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, {
      model: "deepseek-flash",
      choices: [{ message: { content: "answer" } }],
      usage: { prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 0, completion_tokens: 1_000_000, completion_tokens_details: { reasoning_tokens: 0 } },
    }));
    const store = new FakeUsageStore();
    const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });
    // deepseek-flash off-peak: $0.15 cache-miss input + $0.60 output, for 1M/1M tokens.
    expect(result.costUsd).toBeCloseTo(0.15 + 0.6, 10);
  });

  it("feature name and user id are attributed correctly on the logged row", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const store = new FakeUsageStore();
    await gatewayChat(fakeClient, "user-42", "ingestion_summarize", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });
    expect(store.entries[0].userId).toBe("user-42");
    expect(store.entries[0].feature).toBe("ingestion_summarize");
  });

  it("prompt text is hashed, never stored raw, on the logged entry object passed to the store", async () => {
    resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const store = new FakeUsageStore();
    const secretPrompt = "the user's private retrieval answer, never to be persisted raw";
    await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: secretPrompt }], { usageStore: store, now: OFF_PEAK });
    // The gateway hands the STORE the raw promptText (so the store itself
    // decides how to persist it); the real SupabaseUsageStore hashes before
    // insert (see usage-log.test.ts). Assert the gateway didn't invent its
    // own separate raw-text field anywhere else on the entry.
    expect(Object.keys(store.entries[0])).not.toContain("rawPrompt");
  });

  /**
   * Multi-provider, REVERSED 2026-09-15 (the Lead's fix). Every test above
   * omits `opts.provider` and still passes unchanged -- but now because
   * `getAiPreferenceMock` defaults to "no row" (deepseek/cheap), not because
   * of a caller-side DEFAULT_PROVIDER fallback the way it worked before this
   * date (that theory failed 3-for-3 against real callers -- see gateway.ts's
   * own header). These tests are the NEW behavior: an explicit `provider`
   * still wins outright and skips the lookup; an omitted one is now resolved
   * from the caller's OWN saved preference, not silently still DeepSeek.
   */
  describe("provider selection", () => {
    it("an explicit non-deepseek provider resolves ITS OWN key, not DeepSeek's -- proven by resolveApiKeyWithSource's own call args", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-ant-server-key", source: "server" });
      vi.stubGlobal("navigator", undefined); // openai/anthropic/google SDKs vs. jsdom -- see client.test.ts's own note
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { provider: "anthropic", usageStore: store, now: OFF_PEAK });

      expect(result.ok, result.message ?? "").toBe(true);
      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "anthropic");
      expect(store.entries[0].provider).toBe("anthropic");
    });

    it("the cheap/capable tier resolves to THAT provider's own catalog models, not DeepSeek's", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-openai-key", source: "server" });
      vi.stubGlobal("navigator", undefined);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      );
      const { PROVIDERS } = await import("../providers");
      const store = new FakeUsageStore();

      await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { provider: "openai", tier: "capable", usageStore: store, now: OFF_PEAK });
      expect(store.entries[0].model).toBe(PROVIDERS.openai.models.capable);
    });

    it("omitting provider still defaults to deepseek -- the exact prior signature keeps working", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      const store = new FakeUsageStore();
      await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });
      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "deepseek");
      expect(store.entries[0].provider).toBe("deepseek");
    });

    it("costUsd for a non-deepseek provider uses its OWN flat catalog rate, not DeepSeek's peak/off-peak table", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-openai-key", source: "server" });
      vi.stubGlobal("navigator", undefined);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const { MODEL_CATALOG } = await import("../model-catalog");
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], {
        provider: "openai",
        tier: "cheap",
        usageStore: store,
        now: OFF_PEAK,
      });
      const budget = MODEL_CATALOG.openai.budget;
      expect(result.costUsd).toBeCloseTo(budget.inputUsdPer1M + budget.outputUsdPer1M, 5);
    });
  });

  /**
   * Multi-provider, REVERSED 2026-09-15 (the Lead's fix). These are the
   * exact behaviors the reversal exists to deliver: a caller (like
   * answer-feedback-actions.ts) that never passes `provider`/`tier` at all
   * now genuinely routes through the user's own saved preference, and a
   * preference READ FAILURE fails closed (no adapter called) rather than
   * quietly reopening cross-provider fallback via the deepseek default --
   * see preferences.ts's own header for why that distinction is load-bearing.
   */
  describe("preference resolution (provider/tier omitted)", () => {
    it("a caller that omits both provider and tier routes to the user's own saved preference, not deepseek", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "anthropic", modelTier: "capable" } });
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-ant-user-key", source: "user" });
      vi.stubGlobal("navigator", undefined);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "answer_feedback", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok, result.message ?? "").toBe(true);
      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "anthropic");
      expect(store.entries[0].provider).toBe("anthropic");
    });

    it("an explicit provider still wins outright over a saved preference for a different provider", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "openai", modelTier: "capable" } });
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-ant-key", source: "server" });
      vi.stubGlobal("navigator", undefined);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const store = new FakeUsageStore();
      await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { provider: "anthropic", tier: "cheap", usageStore: store, now: OFF_PEAK });

      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "anthropic");
      // Both provider and tier were explicit, so the preference lookup is
      // never consulted at all -- not merely overridden.
      expect(getAiPreferenceMock).not.toHaveBeenCalled();
    });

    it("ingestion's explicit tier:'cheap' still resolves PROVIDER from the book owner's own preference", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "openai", modelTier: "capable" } });
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-openai-key", source: "server" });
      vi.stubGlobal("navigator", undefined);
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      );
      const { PROVIDERS } = await import("../providers");
      const store = new FakeUsageStore();
      await gatewayChat(fakeClient, "u1", "self_mastery_ingestion", [{ role: "user", content: "hi" }], { tier: "cheap", usageStore: store, now: OFF_PEAK });

      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "openai");
      // tier stayed "cheap" (ingestion's forced tier) despite the saved
      // preference being "capable" -- Addition A must never be overridden.
      expect(store.entries[0].model).toBe(PROVIDERS.openai.models.cheap);
    });

    it("THE REGRESSION GUARD: a preference READ ERROR fails closed -- no adapter called, ok:false, nothing logged", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: false, reason: "Couldn't read your AI preference: connection reset" });
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "answer_feedback", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("connection reset");
      expect(resolveApiKeyWithSourceMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.entries).toHaveLength(0);
    });

    it("a non-allowlisted user with a saved preference but no key for that provider: no adapter call, clear no-key result", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "anthropic", modelTier: "cheap" } });
      resolveApiKeyWithSourceMock.mockResolvedValue(null); // no BYO key, not allowlisted for a shared one
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "answer_feedback", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(false);
      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "anthropic");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.entries).toHaveLength(0);
    });
  });

  /**
   * `hasUsableIngestionKey` is the upload gate's own check (2026-09-15, the
   * Lead's fix) -- it must resolve the SAME provider a real ingestion
   * `gatewayChat` call would (the book owner's saved preference), not
   * assume deepseek, and must fail closed (not "usable") on a preference
   * read failure rather than optimistically letting an upload through that
   * gatewayChat itself would then refuse.
   */
  describe("hasUsableIngestionKey", () => {
    it("resolves the SAME provider the preference names, and reports usable when a key exists for it", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "anthropic", modelTier: "cheap" } });
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-ant", source: "user" });

      const result = await hasUsableIngestionKey(fakeClient, "u1");

      expect(resolveApiKeyWithSourceMock).toHaveBeenCalledWith(fakeClient, "u1", "anthropic");
      expect(result).toEqual({ usable: true, providerLabel: expect.any(String) });
    });

    it("not usable when the resolved provider has no key -- the exact case that used to strand a book at 'processing' forever", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: true, preference: { provider: "openai", modelTier: "cheap" } });
      resolveApiKeyWithSourceMock.mockResolvedValue(null);

      const result = await hasUsableIngestionKey(fakeClient, "u1");

      expect(result.usable).toBe(false);
      expect(result.providerLabel).toBeDefined(); // still names the provider, for a precise message
    });

    it("THE REGRESSION GUARD: fails closed on a preference read failure -- not usable, no providerLabel to guess with", async () => {
      getAiPreferenceMock.mockResolvedValue({ ok: false, reason: "connection reset" });

      const result = await hasUsableIngestionKey(fakeClient, "u1");

      expect(result).toEqual({ usable: false });
      expect(resolveApiKeyWithSourceMock).not.toHaveBeenCalled();
    });
  });

  /**
   * P2-01 (2026-09-15 overnight run): a SECOND cap, independent of the
   * existing global `checkSpendCap` (spend-cap.ts) -- see gateway.ts's own
   * comment at the call site. Enforced BEFORE any provider call, same as
   * the global cap.
   */
  describe("monthly spend cap (P2-01)", () => {
    it("blocks before any provider call when the monthly cap is exceeded, and surfaces monthlyCapBlocked", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      checkMonthlySpendCapMock.mockResolvedValue({
        allowed: false,
        reason: "You've reached your AI budget for 2026-09 ($10.00 of $10.00 spent; this call could cost up to ~$0.0010 more).",
        capUsd: 10,
        spentUsd: 10,
        monthKey: "2026-09",
      });
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("2026-09");
      expect(result.monthlyCapBlocked).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.entries).toHaveLength(0);
    });

    it("THE REGRESSION GUARD: a monthly-cap context read failure fails closed -- no adapter called, but NOT reported as monthlyCapBlocked (it's an unresolved check, not a resolved-and-exceeded one)", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      checkMonthlySpendCapMock.mockResolvedValue({ allowed: false, reason: "Couldn't read your AI spend settings: connection reset", contextFailure: true });
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("connection reset");
      expect(result.monthlyCapBlocked).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.entries).toHaveLength(0);
    });

    it("is checked independently of the global spend cap -- a huge global cap override does not bypass it", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      checkMonthlySpendCapMock.mockResolvedValue({ allowed: false, reason: "monthly cap hit", capUsd: 10, spentUsd: 10, monthKey: "2026-09" });
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], {
        usageStore: store,
        now: OFF_PEAK,
      });

      expect(result.ok).toBe(false);
      expect(result.monthlyCapBlocked).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a BYO ('user') key is still subject to the monthly cap -- unlike the global server-key-only cap, this one is key-source-agnostic", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-user-key", source: "user" });
      checkMonthlySpendCapMock.mockResolvedValue({ allowed: false, reason: "monthly cap hit", capUsd: 10, spentUsd: 10, monthKey: "2026-09" });
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(false);
      expect(result.monthlyCapBlocked).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("passes the RESOLVED provider/model/promptChars/maxTokens through, not the caller's raw opts", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      const store = new FakeUsageStore();
      await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { tier: "capable", usageStore: store, now: OFF_PEAK });

      expect(checkMonthlySpendCapMock).toHaveBeenCalledWith(
        fakeClient,
        "u1",
        "deepseek",
        "deepseek-v4-pro",
        expect.any(Number),
        expect.any(Number),
        expect.objectContaining({ store, at: OFF_PEAK }),
      );
    });

    it("allowed:true lets the call through and does not set monthlyCapBlocked on success", async () => {
      resolveApiKeyWithSourceMock.mockResolvedValue({ key: "sk-server-key", source: "server" });
      fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      const store = new FakeUsageStore();
      const result = await gatewayChat(fakeClient, "u1", "test", [{ role: "user", content: "hi" }], { usageStore: store, now: OFF_PEAK });

      expect(result.ok).toBe(true);
      expect(result.monthlyCapBlocked).toBeUndefined();
    });
  });

  describe("ingestionNoKeyMessage", () => {
    it("names the resolved provider when one is known", () => {
      expect(ingestionNoKeyMessage("Claude")).toBe("Add an API key for Claude in Settings, or connect an agent under Settings > Connector, to process books.");
    });

    it("falls back to a generic message when no provider could be resolved", () => {
      expect(ingestionNoKeyMessage(undefined)).toBe("Add an AI provider key in Settings, or connect an agent under Settings > Connector, to process books.");
    });
  });
});
