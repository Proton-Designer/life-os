import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>> & { insert: ReturnType<typeof vi.fn> };
}

let chain: ReturnType<typeof makeChain>;
const fromMock = vi.fn(() => chain);
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

const { hashPrompt, SupabaseUsageStore } = await import("../usage-log");

describe("hashPrompt()", () => {
  it("is deterministic sha256 hex (64 lowercase hex chars)", () => {
    const h = hashPrompt("hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPrompt("hello world")).toBe(h);
  });

  it("different prompts hash differently -- the whole point is never storing the prompt itself", () => {
    expect(hashPrompt("prompt A")).not.toBe(hashPrompt("prompt B"));
  });
});

describe("SupabaseUsageStore", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("record() inserts a hashed prompt, never the raw text, with the right column shape", async () => {
    chain = makeChain({ data: null, error: null });
    const store = new SupabaseUsageStore();
    await store.record({
      userId: "u1",
      feature: "answer_feedback",
      provider: "deepseek",
      model: "deepseek-flash",
      keySource: "server",
      promptText: "the user's private answer text",
      tokens: { promptTokens: 100, cachedPromptTokens: 20, completionTokens: 50, reasoningTokens: 10 },
      costUsd: 0.000123,
      succeeded: true,
      retryCount: 1,
    });
    expect(fromMock).toHaveBeenCalledWith("ai_usage_log");
    const insertedRow = chain.insert.mock.calls[0][0];
    expect(insertedRow.prompt_hash).toBe(hashPrompt("the user's private answer text"));
    expect(JSON.stringify(insertedRow)).not.toContain("private answer text");
    expect(insertedRow).toMatchObject({
      user_id: "u1",
      feature: "answer_feedback",
      key_source: "server",
      input_tokens: 100,
      cached_input_tokens: 20,
      completion_tokens: 50,
      reasoning_tokens: 10,
      cost_usd: 0.000123,
      succeeded: true,
      retry_count: 1,
    });
  });

  it("record() never throws when the insert fails -- a logging outage must not break the feature that triggered it", async () => {
    chain = makeChain({ data: null, error: { message: "boom" } });
    const store = new SupabaseUsageStore();
    await expect(
      store.record({
        userId: "u1", feature: "x", provider: "deepseek", model: "deepseek-flash", keySource: "server",
        promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
        costUsd: 0, succeeded: true, retryCount: 0,
      }),
    ).resolves.not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("totalServerKeySpendUsd() sums cost_usd across the returned rows", async () => {
    chain = makeChain({ data: [{ cost_usd: "0.10" }, { cost_usd: "0.05" }, { cost_usd: 0.02 }], error: null });
    const store = new SupabaseUsageStore();
    const total = await store.totalServerKeySpendUsd();
    expect(total).toBeCloseTo(0.17, 10);
    expect(chain.eq).toHaveBeenCalledWith("key_source", "server");
  });

  it("totalServerKeySpendUsd() fails CLOSED (returns Infinity) when the query errors, never zero", async () => {
    chain = makeChain({ data: null, error: { message: "connection refused" } });
    const store = new SupabaseUsageStore();
    const total = await store.totalServerKeySpendUsd();
    expect(total).toBe(Number.POSITIVE_INFINITY);
  });
});
