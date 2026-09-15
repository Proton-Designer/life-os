import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTranscriptionSpendCap } from "../transcription-spend";
import { estimateWorstCaseTranscriptionCostUsd } from "../transcription-pricing";
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

describe("checkTranscriptionSpendCap", () => {
  it("allows a call well within an unused cap", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 25 }, error: null });
    const store = new FakeUsageStore();

    const result = await checkTranscriptionSpendCap(supabase, "u1", "openai", 5_000_000, { store, at: NOW });

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

    const result = await checkTranscriptionSpendCap(supabase, "u1", "openai", 50_000_000, { store, at: NOW });

    expect(result.allowed).toBe(false);
    if (!result.allowed && !result.contextFailure) {
      expect(result.spentUsd).toBeCloseTo(0.999, 5);
      expect(result.reason).toMatch(/budget/i);
    }
  });

  it("blocks a huge file at a normal cap even with zero prior spend this month", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 0.01 }, error: null });
    const store = new FakeUsageStore();

    const result = await checkTranscriptionSpendCap(supabase, "u1", "openai", 500_000_000, { store, at: NOW });

    expect(result.allowed).toBe(false);
  });

  it("fails CLOSED (contextFailure: true) when the cap context can't be resolved, never defaults to allowed", async () => {
    const supabase = clientWith({ data: null, error: { message: "connection reset" } });
    const store = new FakeUsageStore();

    const result = await checkTranscriptionSpendCap(supabase, "u1", "openai", 1_000_000, { store, at: NOW });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.contextFailure).toBe(true);
  });

  it("estimatedCostUsd matches the pricing module's own worst-case function exactly (no drift between the gate and the pricing table)", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 25 }, error: null });
    const store = new FakeUsageStore();

    const result = await checkTranscriptionSpendCap(supabase, "u1", "google", 8_000_000, { store, at: NOW });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.estimatedCostUsd).toBe(estimateWorstCaseTranscriptionCostUsd("google", 8_000_000));
    }
  });
});
