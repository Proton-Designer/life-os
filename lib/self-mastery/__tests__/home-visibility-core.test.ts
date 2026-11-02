import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { getSelfMasteryOnHomeCore, setSelfMasteryOnHomeCore } from "../home-visibility-core";

type Resp = { data: unknown; error: unknown };
function client(responses: Resp[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = [...responses];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "upsert"]) chain[m] = vi.fn((...args: unknown[]) => (calls.push({ method: m, args }), chain));
  const next = () => queue.shift() ?? { data: null, error: null };
  chain.maybeSingle = vi.fn(async () => next());
  chain.then = (res: (v: Resp) => void) => res(next());
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, calls };
}

describe("getSelfMasteryOnHomeCore", () => {
  it("reads the column; no row = ON (nobody's Home changes unless they chose it)", async () => {
    expect(await getSelfMasteryOnHomeCore(client([{ data: { self_mastery_on_home: false }, error: null }]).client, "u1")).toBe(false);
    expect(await getSelfMasteryOnHomeCore(client([{ data: { self_mastery_on_home: true }, error: null }]).client, "u1")).toBe(true);
    expect(await getSelfMasteryOnHomeCore(client([{ data: null, error: null }]).client, "u1")).toBe(true);
  });

  it("a read error is thrown (the caller decides the fallback), not swallowed here", async () => {
    await expect(getSelfMasteryOnHomeCore(client([{ data: null, error: new Error("column missing") }]).client, "u1")).rejects.toThrow("column missing");
  });
});

describe("setSelfMasteryOnHomeCore", () => {
  it("ensures the row, writes the flag for this user only, and proves a row changed", async () => {
    const { client: c, calls } = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    expect(await setSelfMasteryOnHomeCore(c, "u1", false)).toBe(false);
    expect(calls.find((x) => x.method === "upsert")!.args[0]).toEqual({ user_id: "u1" });
    expect(calls.find((x) => x.method === "update")!.args[0]).toEqual({ self_mastery_on_home: false });
    expect(calls.find((x) => x.method === "eq")!.args).toEqual(["user_id", "u1"]);
  });

  it("a non-boolean is refused before any write", async () => {
    const { client: c, calls } = client([]);
    await expect(setSelfMasteryOnHomeCore(c, "u1", "no" as unknown as boolean)).rejects.toThrow(/true or false/);
    expect(calls).toEqual([]);
  });

  it("zero rows updated is an error, a database error is thrown", async () => {
    await expect(setSelfMasteryOnHomeCore(client([{ data: null, error: null }, { data: [], error: null }]).client, "u1", true)).rejects.toThrow(/not saved/);
    await expect(setSelfMasteryOnHomeCore(client([{ data: null, error: null }, { data: null, error: new Error("denied") }]).client, "u1", true)).rejects.toThrow("denied");
  });
});
