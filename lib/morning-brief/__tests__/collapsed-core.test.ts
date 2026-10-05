import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { isCollapsedFor, isMorningBriefCollapsed, setMorningBriefCollapsedCore } from "../collapsed-core";

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

describe("isCollapsedFor", () => {
  it("collapsed only for the brief_date the user minimized; a newer brief shows expanded again", () => {
    expect(isCollapsedFor("2026-10-04", "2026-10-04")).toBe(true);
    expect(isCollapsedFor("2026-10-04", "2026-10-05")).toBe(false); // the next day's brief
    expect(isCollapsedFor(null, "2026-10-04")).toBe(false);
    expect(isCollapsedFor(undefined, "2026-10-04")).toBe(false);
  });
});

describe("isMorningBriefCollapsed", () => {
  it("reads the stored date against today's brief_date; no row reads as expanded", async () => {
    expect(await isMorningBriefCollapsed(client([{ data: { morning_brief_collapsed_on: "2026-10-04" }, error: null }]).client, "u1", "2026-10-04")).toBe(true);
    expect(await isMorningBriefCollapsed(client([{ data: { morning_brief_collapsed_on: "2026-10-04" }, error: null }]).client, "u1", "2026-10-05")).toBe(false);
    expect(await isMorningBriefCollapsed(client([{ data: null, error: null }]).client, "u1", "2026-10-04")).toBe(false);
  });
});

describe("setMorningBriefCollapsedCore", () => {
  it("collapsed=true stores the brief_date; collapsed=false clears it (absolute, never a toggle)", async () => {
    const a = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    await setMorningBriefCollapsedCore(a.client, "u1", "2026-10-04", true);
    expect(a.calls.find((x) => x.method === "update")!.args[0]).toEqual({ morning_brief_collapsed_on: "2026-10-04" });
    const b = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    await setMorningBriefCollapsedCore(b.client, "u1", "2026-10-04", false);
    expect(b.calls.find((x) => x.method === "update")!.args[0]).toEqual({ morning_brief_collapsed_on: null });
  });
  it("is user-scoped on every statement", async () => {
    const a = client([{ data: null, error: null }, { data: [{ user_id: "u1" }], error: null }]);
    await setMorningBriefCollapsedCore(a.client, "u1", "2026-10-04", true);
    expect(a.calls.filter((x) => x.method === "eq").every((x) => x.args[0] === "user_id" && x.args[1] === "u1")).toBe(true);
  });
  it("rejects a malformed date before any write; 0 rows is an error", async () => {
    const a = client([]);
    await expect(setMorningBriefCollapsedCore(a.client, "u1", "tomorrow", true)).rejects.toThrow(/Invalid brief date/);
    expect(a.calls).toHaveLength(0);
    const b = client([{ data: null, error: null }, { data: [], error: null }]);
    await expect(setMorningBriefCollapsedCore(b.client, "u1", "2026-10-04", true)).rejects.toThrow(/Couldn't save/);
  });
});
