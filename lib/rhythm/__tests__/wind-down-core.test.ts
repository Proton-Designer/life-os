import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWindDownSettingsCore, saveWindDownPlanCore } from "../wind-down-core";

type Resp = { data: unknown; error: unknown };
function client(responses: Resp[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = [...responses];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "upsert"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
  const next = () => queue.shift() ?? { data: null, error: null };
  chain.maybeSingle = vi.fn(async () => next());
  chain.then = (res: (v: Resp) => void) => res(next());
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, calls };
}

describe("getWindDownSettingsCore", () => {
  it("derives the plan from the three stored inputs", async () => {
    const { client: c } = client([{ data: { wake_time: "07:00", sleep_need_minutes: 480, wind_down_minutes: 45 }, error: null }]);
    expect(await getWindDownSettingsCore(c, "u1")).toMatchObject({ wakeTime: "07:00", plan: { bedtime: "23:00", windDownStart: "22:15" } });
  });
  it("no settings row / nothing set = no plan (callers use their defaults)", async () => {
    const { client: c } = client([{ data: null, error: null }]);
    expect((await getWindDownSettingsCore(c, "u1")).plan).toBeNull();
  });
});

describe("saveWindDownPlanCore", () => {
  it("ensures the row, updates the three columns (default 45), and proves a row changed", async () => {
    const { client: c, calls } = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    const plan = await saveWindDownPlanCore(c, "u1", { wakeTime: "07:00", sleepNeedMinutes: 480 });
    expect(plan).toMatchObject({ bedtime: "23:00", windDownStart: "22:15", windDownMinutes: 45 });
    expect(calls.find((x) => x.method === "upsert")!.args[1]).toMatchObject({ ignoreDuplicates: true });
    expect(calls.find((x) => x.method === "update")!.args[0]).toEqual({ wake_time: "07:00", sleep_need_minutes: 480, wind_down_minutes: 45 });
  });
  it("rejects invalid input before any write", async () => {
    const { client: c, calls } = client([]);
    await expect(saveWindDownPlanCore(c, "u1", { wakeTime: "99:00", sleepNeedMinutes: 480 })).rejects.toThrow(/wake time/i);
    expect(calls).toHaveLength(0);
  });
  it("0 rows updated is an error, never a silent success", async () => {
    const { client: c } = client([{ data: null, error: null }, { data: [], error: null }]);
    await expect(saveWindDownPlanCore(c, "u1", { wakeTime: "07:00", sleepNeedMinutes: 480 })).rejects.toThrow(/not saved/);
  });
});
