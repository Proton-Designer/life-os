import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateAppearanceCore, setWeekdayBaselinesCore, clearWeekdayBaselinesCore } from "../actions-core";

function makeClient() {
  const upsertCalls: Record<string, unknown>[] = [];
  const updateCalls: { table: string; row: Record<string, unknown>; eq: unknown[] }[] = [];

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.upsert = vi.fn((row: Record<string, unknown>) => {
      upsertCalls.push(row);
      return Promise.resolve({ error: null });
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      const call = { table, row, eq: [] as unknown[] };
      updateCalls.push(call);
      const updateChain: Record<string, unknown> = {};
      updateChain.eq = vi.fn((...args: unknown[]) => {
        call.eq = args;
        return Promise.resolve({ error: null });
      });
      return updateChain;
    });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, upsertCalls, updateCalls };
}

describe("updateAppearanceCore", () => {
  it("upserts theme_preset alone", async () => {
    const { client, upsertCalls } = makeClient();
    const result = await updateAppearanceCore(client, "user-1", { theme_preset: "ocean", hidden_features: undefined });
    expect(result).toEqual({ theme_preset: "ocean" });
    expect(upsertCalls[0]).toEqual({ user_id: "user-1", theme_preset: "ocean" });
  });

  it("upserts hidden_features alone", async () => {
    const { client, upsertCalls } = makeClient();
    const result = await updateAppearanceCore(client, "user-1", { theme_preset: undefined, hidden_features: ["fitness", "insights"] });
    expect(result).toEqual({ hidden_features: ["fitness", "insights"] });
    expect(upsertCalls[0]).toEqual({ user_id: "user-1", hidden_features: ["fitness", "insights"] });
  });

  it("upserts both together", async () => {
    const { client, upsertCalls } = makeClient();
    await updateAppearanceCore(client, "user-1", { theme_preset: "mono", hidden_features: [] });
    expect(upsertCalls[0]).toEqual({ user_id: "user-1", theme_preset: "mono", hidden_features: [] });
  });

  it("rejects an unknown theme_preset", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { theme_preset: "cyberpunk" })).rejects.toThrow(/theme_preset must be one of/i);
  });

  it("REJECTS 'home' in hidden_features with a specific, deliberate-not-a-bug message — not the generic invalid-feature error", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { hidden_features: ["home"] })).rejects.toThrow(/can never be hidden/i);
    await expect(updateAppearanceCore(client, "user-1", { hidden_features: ["home"] })).rejects.toThrow(/self-inflicted lockout/i);
  });

  it("REJECTS 'settings' in hidden_features the same specific way", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { hidden_features: ["settings"] })).rejects.toThrow(/can never be hidden/i);
  });

  it("rejects a genuinely unknown feature id with the generic message, distinct from home/settings' specific one", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { hidden_features: ["sleep"] })).rejects.toThrow(/not a real feature id/i);
  });

  it("rejects a non-array hidden_features", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { hidden_features: "deen" })).rejects.toThrow(/must be an array/i);
  });

  it("rejects an empty patch — must name at least one field", async () => {
    const { client } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", {})).rejects.toThrow(/at least one of/i);
  });

  it("never partially writes on a validation failure — hidden_features rejected means theme_preset (even if also given) never reaches the upsert", async () => {
    const { client, upsertCalls } = makeClient();
    await expect(updateAppearanceCore(client, "user-1", { theme_preset: "ocean", hidden_features: ["home"] })).rejects.toThrow();
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("setWeekdayBaselinesCore", () => {
  it("writes exactly 7 whole-number hours", async () => {
    const { client, updateCalls } = makeClient();
    const result = await setWeekdayBaselinesCore(client, "user-1", [0, 1, 2, 3, 4, 5, 6]);
    expect(result).toEqual({ values: [0, 1, 2, 3, 4, 5, 6] });
    expect(updateCalls[0]).toMatchObject({ table: "user_settings", row: { weekday_baselines: [0, 1, 2, 3, 4, 5, 6] }, eq: ["user_id", "user-1"] });
  });

  it("rejects a value out of 0-12 range", async () => {
    const { client } = makeClient();
    await expect(setWeekdayBaselinesCore(client, "user-1", [13, 0, 0, 0, 0, 0, 0])).rejects.toThrow(/0 to 12/);
  });

  it("rejects a non-integer value", async () => {
    const { client } = makeClient();
    await expect(setWeekdayBaselinesCore(client, "user-1", [1.5, 0, 0, 0, 0, 0, 0])).rejects.toThrow(/whole number/i);
  });

  it("rejects an array that isn't exactly 7 long", async () => {
    const { client } = makeClient();
    await expect(setWeekdayBaselinesCore(client, "user-1", [0, 0, 0])).rejects.toThrow(/exactly 7/);
  });

  it("all-zeros is valid — seven deliberate rest days is a real state, not an error", async () => {
    const { client, updateCalls } = makeClient();
    await setWeekdayBaselinesCore(client, "user-1", [0, 0, 0, 0, 0, 0, 0]);
    expect(updateCalls[0].row).toEqual({ weekday_baselines: [0, 0, 0, 0, 0, 0, 0] });
  });
});

describe("clearWeekdayBaselinesCore", () => {
  it("sets NULL, never an all-zero array — 'never set' and 'seven rest days' are different real states", async () => {
    const { client, updateCalls } = makeClient();
    await clearWeekdayBaselinesCore(client, "user-1");
    expect(updateCalls[0]).toMatchObject({ table: "user_settings", row: { weekday_baselines: null }, eq: ["user_id", "user-1"] });
  });
});
