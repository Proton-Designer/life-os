import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { getFocusTargetSettingsCore, loadFocusTargetMinutes, saveFocusTargetsCore } from "../target-core";

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

describe("getFocusTargetSettingsCore / loadFocusTargetMinutes", () => {
  it("maps the two columns; no row = nothing set", async () => {
    expect(await getFocusTargetSettingsCore(client([{ data: { daily_focus_target_minutes: 300, weekend_focus_target_minutes: 120 }, error: null }]).client, "u1")).toEqual({ dailyMinutes: 300, weekendMinutes: 120 });
    expect(await getFocusTargetSettingsCore(client([{ data: null, error: null }]).client, "u1")).toEqual({ dailyMinutes: null, weekendMinutes: null });
  });
  it("the loader resolves the right target for the local date (weekend vs weekday)", async () => {
    const row = { data: { daily_focus_target_minutes: 300, weekend_focus_target_minutes: 120 }, error: null };
    expect(await loadFocusTargetMinutes(client([row]).client, "u1", "2026-10-03")).toBe(120); // Saturday
    expect(await loadFocusTargetMinutes(client([row]).client, "u1", "2026-10-05")).toBe(300); // Monday
    expect(await loadFocusTargetMinutes(client([{ data: null, error: null }]).client, "u1", "2026-10-05")).toBe(240);
  });
  it("a read error is thrown, not swallowed into the default", async () => {
    await expect(getFocusTargetSettingsCore(client([{ data: null, error: new Error("boom") }]).client, "u1")).rejects.toThrow("boom");
  });
});

describe("saveFocusTargetsCore", () => {
  it("ensures the row, writes both absolute values (null clears), and proves a row changed", async () => {
    const { client: c, calls } = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    await saveFocusTargetsCore(c, "u1", { dailyMinutes: 300, weekendMinutes: null });
    expect(calls.find((x) => x.method === "upsert")!.args[1]).toMatchObject({ ignoreDuplicates: true });
    expect(calls.find((x) => x.method === "update")!.args[0]).toEqual({ daily_focus_target_minutes: 300, weekend_focus_target_minutes: null });
    expect(calls.filter((x) => x.method === "eq").every((x) => x.args[0] === "user_id" && x.args[1] === "u1")).toBe(true);
  });
  it("rejects an out-of-range target before any write", async () => {
    const { client: c, calls } = client([]);
    await expect(saveFocusTargetsCore(c, "u1", { dailyMinutes: 10, weekendMinutes: null })).rejects.toThrow(/Daily/);
    expect(calls).toHaveLength(0);
  });
  it("0 rows updated is an error, never a silent success", async () => {
    const { client: c } = client([{ data: null, error: null }, { data: [], error: null }]);
    await expect(saveFocusTargetsCore(c, "u1", { dailyMinutes: 300, weekendMinutes: null })).rejects.toThrow(/not saved/);
  });
});
