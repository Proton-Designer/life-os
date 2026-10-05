import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const order: string[] = [];
const saveWindDownPlanCore = vi.fn(async (..._a: unknown[]) => {
  order.push("plan");
  return { bedtime: "23:00", windDownStart: "22:15", windDownMinutes: 45 };
});
const createMorningRoutineItemCore = vi.fn(async (_s: unknown, _u: unknown, label: string) => {
  order.push(`step:${label}`);
  return { id: label };
});
vi.mock("@/lib/rhythm/wind-down-core", () => ({ saveWindDownPlanCore: (...a: unknown[]) => saveWindDownPlanCore(...a) }));
vi.mock("@/lib/morning-routine/actions-core", () => ({
  MAX_ROUTINE_ITEMS: 5,
  createMorningRoutineItemCore: (...a: [unknown, unknown, string]) => createMorningRoutineItemCore(...a),
}));

const { setUpDayCore } = await import("../actions-core");

function makeClient(opts: { existing?: string[] | null; upsertError?: unknown } = {}) {
  const upserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("profiles");
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: opts.existing === undefined ? null : { enabled_features: opts.existing }, error: null }));
    chain.upsert = vi.fn(async (row: Record<string, unknown>) => {
      order.push("features");
      upserts.push(row);
      return { error: opts.upsertError ?? null };
    });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, upserts, from };
}

const base = { wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45, routineSteps: ["Drink water", "Stretch", ""] };

describe("setUpDayCore", () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it("writes the plan, then the steps, and switches the features on LAST", async () => {
    const { client, upserts } = makeClient({ existing: [] });
    const res = await setUpDayCore(client, "u1", base);
    expect(order).toEqual(["plan", "step:Drink water", "step:Stretch", "features"]);
    expect(upserts[0]).toEqual({ user_id: "u1", enabled_features: ["sleep_plan", "morning_routine"] });
    expect(res).toMatchObject({ stepsCreated: 2, featuresEnabled: ["sleep_plan", "morning_routine"] });
    expect(saveWindDownPlanCore).toHaveBeenCalledWith(client, "u1", { wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45 });
  });

  it("with no steps only the sleep plan is enabled (the routine stays off), blank steps are dropped", async () => {
    const { client, upserts } = makeClient({ existing: [] });
    const res = await setUpDayCore(client, "u1", { ...base, routineSteps: ["", "   "] });
    expect(createMorningRoutineItemCore).not.toHaveBeenCalled();
    expect(upserts[0]).toEqual({ user_id: "u1", enabled_features: ["sleep_plan"] });
    expect(res.stepsCreated).toBe(0);
  });

  it("is ADDITIVE: keeps the user's other opt-ins, never duplicates, drops stale unknown ids", async () => {
    const { client, upserts } = makeClient({ existing: ["cards_library", "sleep_plan", "retired_feature"] });
    await setUpDayCore(client, "u1", base);
    expect((upserts[0]!.enabled_features as string[]).sort()).toEqual(["cards_library", "morning_routine", "sleep_plan"]);
  });

  it("a brand-new account with no profile row still works (upsert creates it)", async () => {
    const { client, upserts } = makeClient({ existing: undefined as never });
    await setUpDayCore(client, "u1", { ...base, routineSteps: [] });
    expect(upserts[0]).toEqual({ user_id: "u1", enabled_features: ["sleep_plan"] });
  });

  it("validates EVERYTHING before any write: a bad wake time, bad sleep need, too many steps or an over-long step writes nothing", async () => {
    for (const bad of [
      { ...base, wakeTime: "" },
      { ...base, wakeTime: "25:00" },
      { ...base, sleepNeedMinutes: 120 },
      { ...base, windDownMinutes: 5 },
      { ...base, routineSteps: ["a", "b", "c", "d"] },
      { ...base, routineSteps: ["x".repeat(121)] },
    ]) {
      const { client, from } = makeClient({ existing: [] });
      await expect(setUpDayCore(client, "u1", bad), JSON.stringify(bad).slice(0, 60)).rejects.toThrow();
      expect(from).not.toHaveBeenCalled();
      expect(saveWindDownPlanCore).not.toHaveBeenCalled();
      expect(createMorningRoutineItemCore).not.toHaveBeenCalled();
    }
  });

  it("a failure part-way leaves the features OFF (nothing half-built ever shows on Home)", async () => {
    createMorningRoutineItemCore.mockRejectedValueOnce(new Error("boom"));
    const { client, upserts } = makeClient({ existing: [] });
    await expect(setUpDayCore(client, "u1", base)).rejects.toThrow("boom");
    expect(upserts).toHaveLength(0);
    expect(order).not.toContain("features");
  });

  it("surfaces a failed feature write", async () => {
    const { client } = makeClient({ existing: [], upsertError: new Error("denied") });
    await expect(setUpDayCore(client, "u1", base)).rejects.toThrow("denied");
  });
});
