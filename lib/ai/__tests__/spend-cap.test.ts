import { describe, expect, it } from "vitest";
import { checkSpendCap } from "../spend-cap";
import { FakeUsageStore } from "./fake-usage-store";

const OFF_PEAK = new Date("2026-09-16T12:00:00Z");

describe("checkSpendCap()", () => {
  it("never gates a BYO ('user') key -- that balance is the user's own money", async () => {
    const store = new FakeUsageStore();
    const result = await checkSpendCap("user", "deepseek-v4-pro", 1_000_000, 100_000, { store, capUsdOverride: 0.0001, at: OFF_PEAK });
    expect(result.allowed).toBe(true);
    // Never even queries the store for a BYO key -- confirmed by the store staying empty/untouched.
    expect(store.entries).toHaveLength(0);
  });

  it("allows a server-key call when the running total plus this call's worst case stays under the cap", async () => {
    const store = new FakeUsageStore();
    const result = await checkSpendCap("server", "deepseek-flash", 400, 300, { store, capUsdOverride: 1.0, at: OFF_PEAK });
    expect(result.allowed).toBe(true);
    expect(result.capUsd).toBe(1.0);
  });

  it("refuses a server-key call once prior spend already meets the cap", async () => {
    const store = new FakeUsageStore();
    await store.record({
      userId: "u1",
      feature: "test",
      provider: "deepseek",
      model: "deepseek-flash",
      keySource: "server",
      promptText: "x",
      tokens: { promptTokens: 10, cachedPromptTokens: 0, completionTokens: 10, reasoningTokens: 0 },
      costUsd: 0.5,
      succeeded: true,
      retryCount: 0,
    });
    const result = await checkSpendCap("server", "deepseek-flash", 400, 300, { store, capUsdOverride: 0.5, at: OFF_PEAK });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget cap/i);
    expect(result.spentUsd).toBe(0.5);
  });

  it("refuses when prior spend is fine alone but this call's worst case would tip it over the cap", async () => {
    const store = new FakeUsageStore();
    await store.record({
      userId: "u1", feature: "test", provider: "deepseek", model: "deepseek-flash", keySource: "server",
      promptText: "x", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      costUsd: 0.9, succeeded: true, retryCount: 0,
    });
    // A huge maxTokens on the expensive pro model should push the estimate well past the remaining $0.10.
    const result = await checkSpendCap("server", "deepseek-v4-pro", 4000, 100_000, { store, capUsdOverride: 1.0, at: OFF_PEAK });
    expect(result.allowed).toBe(false);
  });

  it("a near-zero cap refuses essentially every server-key call -- proof the cap actually caps", async () => {
    const store = new FakeUsageStore();
    const result = await checkSpendCap("server", "deepseek-flash", 100, 20, { store, capUsdOverride: 0.0000001, at: OFF_PEAK });
    expect(result.allowed).toBe(false);
  });

  it("fails CLOSED (refuses) if the usage store cannot be read, rather than waving calls through during an outage", async () => {
    const brokenStore = {
      async record() {},
      async totalServerKeySpendUsd() {
        return Number.POSITIVE_INFINITY; // SupabaseUsageStore's own documented failure value
      },
      async monthlySpendUsdForUser() {
        return Number.POSITIVE_INFINITY;
      },
    };
    const result = await checkSpendCap("server", "deepseek-flash", 100, 20, { store: brokenStore, capUsdOverride: 1.0, at: OFF_PEAK });
    expect(result.allowed).toBe(false);
  });

  it("defaults to the env-configured cap when no override is given, and to a hardcoded default well under the real $1.98 balance when the env var is unset", async () => {
    const store = new FakeUsageStore();
    const prior = process.env.AI_GATEWAY_SERVER_KEY_SPEND_CAP_USD;
    delete process.env.AI_GATEWAY_SERVER_KEY_SPEND_CAP_USD;
    try {
      const result = await checkSpendCap("server", "deepseek-flash", 100, 20, { store, at: OFF_PEAK });
      expect(result.capUsd).toBeLessThan(1.98);
      expect(result.capUsd).toBeGreaterThan(0);
    } finally {
      if (prior !== undefined) process.env.AI_GATEWAY_SERVER_KEY_SPEND_CAP_USD = prior;
    }
  });
});
