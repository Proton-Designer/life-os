import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { getSelfMasterySettingsCore, saveSelfMasterySettingsCore } from "../session-settings-core";

type Resp = { data: unknown; error: unknown };
function client(responses: Resp[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = [...responses];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "upsert"]) {
    chain[m] = vi.fn((...args: unknown[]) => (calls.push({ method: m, args }), chain));
  }
  const next = () => queue.shift() ?? { data: null, error: null };
  chain.maybeSingle = vi.fn(async () => next());
  chain.then = (res: (v: Resp) => void) => res(next());
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, calls };
}

describe("getSelfMasterySettingsCore", () => {
  it("reads the two columns; no row = the column defaults", async () => {
    expect(await getSelfMasterySettingsCore(client([{ data: { daily_new_limit: 12, session_target_minutes: 15 }, error: null }]).client, "u1")).toEqual({
      dailyNewLimit: 12,
      sessionTargetMinutes: 15,
    });
    expect(await getSelfMasterySettingsCore(client([{ data: null, error: null }]).client, "u1")).toEqual({ dailyNewLimit: 5, sessionTargetMinutes: 8 });
  });

  it("a read error is thrown, not swallowed into the defaults", async () => {
    await expect(getSelfMasterySettingsCore(client([{ data: null, error: new Error("boom") }]).client, "u1")).rejects.toThrow("boom");
  });
});

describe("saveSelfMasterySettingsCore", () => {
  it("ensures the row, writes both values for this user only, and proves a row changed", async () => {
    const { client: c, calls } = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    expect(await saveSelfMasterySettingsCore(c, "u1", { dailyNewLimit: 12, sessionTargetMinutes: 15 })).toEqual({ dailyNewLimit: 12, sessionTargetMinutes: 15 });
    expect(calls.find((x) => x.method === "upsert")!.args[0]).toEqual({ user_id: "u1" });
    expect(calls.find((x) => x.method === "update")!.args[0]).toEqual({ daily_new_limit: 12, session_target_minutes: 15 });
    expect(calls.find((x) => x.method === "eq")!.args).toEqual(["user_id", "u1"]);
  });

  it("an out-of-range value is refused BEFORE any write (the DB would reject 51, but accept session minutes of 500: it has no CHECK)", async () => {
    const { client: c, calls } = client([]);
    await expect(saveSelfMasterySettingsCore(c, "u1", { dailyNewLimit: 5, sessionTargetMinutes: 500 })).rejects.toThrow(/Daily session length/);
    await expect(saveSelfMasterySettingsCore(c, "u1", { dailyNewLimit: 51, sessionTargetMinutes: 8 })).rejects.toThrow(/New cards per day/);
    expect(calls).toEqual([]);
  });

  it("zero rows updated is an error, not a silent success", async () => {
    const { client: c } = client([{ data: null, error: null }, { data: [], error: null }]);
    await expect(saveSelfMasterySettingsCore(c, "u1", { dailyNewLimit: 5, sessionTargetMinutes: 8 })).rejects.toThrow(/not saved/);
  });

  it("a database error is thrown", async () => {
    const { client: c } = client([{ data: null, error: null }, { data: null, error: new Error("denied") }]);
    await expect(saveSelfMasterySettingsCore(c, "u1", { dailyNewLimit: 5, sessionTargetMinutes: 8 })).rejects.toThrow("denied");
  });
});
