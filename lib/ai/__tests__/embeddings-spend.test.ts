import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkEmbeddingSpendCap } from "../embeddings-spend";
import { FakeUsageStore } from "./fake-usage-store";

const NOW = new Date("2026-09-15T12:00:00Z");

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolvedValue));
  return chain;
}

function clientWith(resolvedValue: { data: unknown; error: unknown }): SupabaseClient {
  const chain = makeChain(resolvedValue);
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("checkEmbeddingSpendCap", () => {
  it("allows a call well within an unused cap", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 25 }, error: null });
    const store = new FakeUsageStore();

    const result = await checkEmbeddingSpendCap(supabase, "u1", "openai", ["a".repeat(1000)], { store, at: NOW });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.capUsd).toBe(25);
      expect(result.spentUsd).toBe(0);
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
    }
  });

  it("blocks when spent-so-far plus the worst-case estimate would exceed the cap, and reports both numbers", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 1 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      {
        userId: "u1",
        feature: "answer_feedback",
        provider: "deepseek",
        model: "deepseek-flash",
        keySource: "user",
        promptText: "x",
        tokens: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, reasoningTokens: 0 },
        costUsd: 0.999,
        succeeded: true,
        retryCount: 0,
      },
      NOW,
    );

    const result = await checkEmbeddingSpendCap(supabase, "u1", "openai", ["a".repeat(4_000_000)], { store, at: NOW });

    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.contextFailure) {
      expect(result.spentUsd).toBeCloseTo(0.999, 5);
      expect(result.reason).toMatch(/budget/i);
    }
  });

  it("this user's embedding spend counts toward the SAME monthly total chat spend already accrued -- not a separate pool", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 10 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      {
        userId: "u1",
        feature: "morning_brief",
        provider: "deepseek",
        model: "deepseek-flash",
        keySource: "user",
        promptText: "x",
        tokens: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1, reasoningTokens: 0 },
        costUsd: 9.99,
        succeeded: true,
        retryCount: 0,
      },
      NOW,
    );

    const result = await checkEmbeddingSpendCap(supabase, "u1", "openai", ["a".repeat(4_000_000)], { store, at: NOW });
    expect(result.allowed).toBe(false); // 9.99 already spent + a real estimate pushes past the $10 cap
  });

  it("fails CLOSED (contextFailure: true) when the cap context can't be resolved, never defaults to allowed", async () => {
    const supabase = clientWith({ data: null, error: { message: "connection reset" } });
    const store = new FakeUsageStore();

    const result = await checkEmbeddingSpendCap(supabase, "u1", "openai", ["hello"], { store, at: NOW });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.contextFailure).toBe(true);
  });
});
