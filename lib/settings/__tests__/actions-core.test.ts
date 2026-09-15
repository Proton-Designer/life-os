import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateAppearanceCore, setWeekdayBaselinesCore, clearWeekdayBaselinesCore } from "../actions-core";
import { makeFakeUserSettingsDb } from "./fake-user-settings-db";

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
  it("writes exactly 7 whole-number hours to an account that already has a user_settings row", async () => {
    const db = makeFakeUserSettingsDb({ existingUserIds: ["user-1"] });
    const result = await setWeekdayBaselinesCore(db.client, "user-1", [0, 1, 2, 3, 4, 5, 6]);
    expect(result).toEqual({ values: [0, 1, 2, 3, 4, 5, 6] });
    expect(db.rows.get("user-1")?.weekday_baselines).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  // P4-23 positive control. 10/30 production accounts (incl. the owner and
  // SEED) have no user_settings row; a bare UPDATE matched 0 rows and the
  // MCP write reported "set weekday baselines to [...]" while storing nothing.
  it("P4-23: an account with NO user_settings row gets the row created and the values actually stored", async () => {
    const db = makeFakeUserSettingsDb();
    expect(db.rows.has("user-1")).toBe(false);
    await setWeekdayBaselinesCore(db.client, "user-1", [2, 3, 3, 3, 3, 3, 0]);
    expect(db.rows.get("user-1")?.weekday_baselines).toEqual([2, 3, 3, 3, 3, 3, 0]);
    // Other ULM defaults must survive the ensure-insert.
    expect(db.rows.get("user-1")?.daily_new_limit).toBe(5);
  });

  it("P4-23: never reports success when the UPDATE matched 0 rows (ensure-insert silently dropped)", async () => {
    const db = makeFakeUserSettingsDb({ dropInserts: true });
    await expect(setWeekdayBaselinesCore(db.client, "user-1", [1, 1, 1, 1, 1, 1, 1])).rejects.toThrow(/no user_settings row/i);
    expect(db.rows.size).toBe(0);
  });

  it("does not overwrite other columns of an existing row", async () => {
    const db = makeFakeUserSettingsDb({ existingUserIds: ["user-1"] });
    db.rows.set("user-1", { ...db.rows.get("user-1"), daily_new_limit: 20 });
    await setWeekdayBaselinesCore(db.client, "user-1", [1, 1, 1, 1, 1, 1, 1]);
    expect(db.rows.get("user-1")?.daily_new_limit).toBe(20);
  });

  it("rejects a value out of 0-12 range", async () => {
    const db = makeFakeUserSettingsDb();
    await expect(setWeekdayBaselinesCore(db.client, "user-1", [13, 0, 0, 0, 0, 0, 0])).rejects.toThrow(/0 to 12/);
    expect(db.rows.size).toBe(0);
  });

  it("rejects a non-integer value", async () => {
    const db = makeFakeUserSettingsDb();
    await expect(setWeekdayBaselinesCore(db.client, "user-1", [1.5, 0, 0, 0, 0, 0, 0])).rejects.toThrow(/whole number/i);
  });

  it("rejects an array that isn't exactly 7 long", async () => {
    const db = makeFakeUserSettingsDb();
    await expect(setWeekdayBaselinesCore(db.client, "user-1", [0, 0, 0])).rejects.toThrow(/exactly 7/);
  });

  it("all-zeros is valid — seven deliberate rest days is a real state, not an error", async () => {
    const db = makeFakeUserSettingsDb({ existingUserIds: ["user-1"] });
    await setWeekdayBaselinesCore(db.client, "user-1", [0, 0, 0, 0, 0, 0, 0]);
    expect(db.rows.get("user-1")?.weekday_baselines).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("clearWeekdayBaselinesCore", () => {
  it("sets NULL, never an all-zero array — 'never set' and 'seven rest days' are different real states", async () => {
    const db = makeFakeUserSettingsDb({ existingUserIds: ["user-1"] });
    db.rows.set("user-1", { ...db.rows.get("user-1"), weekday_baselines: [1, 2, 3, 4, 5, 6, 0] });
    await clearWeekdayBaselinesCore(db.client, "user-1");
    expect(db.rows.get("user-1")?.weekday_baselines).toBeNull();
  });

  it("P4-23: an account with NO user_settings row ends with a row whose baselines are NULL", async () => {
    const db = makeFakeUserSettingsDb();
    await clearWeekdayBaselinesCore(db.client, "user-1");
    expect(db.rows.has("user-1")).toBe(true);
    expect(db.rows.get("user-1")?.weekday_baselines).toBeNull();
  });

  it("P4-23: never reports success when the UPDATE matched 0 rows", async () => {
    const db = makeFakeUserSettingsDb({ dropInserts: true });
    await expect(clearWeekdayBaselinesCore(db.client, "user-1")).rejects.toThrow(/no user_settings row/i);
  });
});
