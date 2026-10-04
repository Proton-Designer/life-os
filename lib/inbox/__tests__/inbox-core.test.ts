import { describe, expect, it, vi } from "vitest";
import { getInboxItems, triageInboxCore } from "../inbox-core";
import type { SupabaseClient } from "@supabase/supabase-js";

type Call = [string, ...unknown[]];

/** Records every chained call; the terminal await resolves to `result`. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "is", "order", "limit"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, ...args]);
      return chain;
    });
  }
  chain.then = (resolve: (v: typeof result) => void) => resolve(result);
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, calls };
}

const INBOX_SHAPE: Call[] = [
  ["eq", "user_id", "u1"],
  ["is", "domain", null],
  ["eq", "dump_source", "capture"],
  ["eq", "completed", false],
];

describe("getInboxItems", () => {
  it("reads exactly the Inbox shape: domain null, dump_source capture, not completed", async () => {
    const { client, calls } = fakeClient({ data: [{ id: "a", title: "T", due_date: "2026-10-09" }], error: null });
    const items = await getInboxItems(client, "u1");
    expect(items).toEqual([{ id: "a", title: "T", dueDate: "2026-10-09" }]);
    for (const c of INBOX_SHAPE) expect(calls).toContainEqual(c);
  });
});

describe("triageInboxCore", () => {
  const ok = { data: [{ id: "i1" }], error: null };

  async function run(triage: Parameters<typeof triageInboxCore>[3], result: { data: unknown; error: unknown } = ok) {
    const f = fakeClient(result);
    const res = await triageInboxCore(f.client, "u1", "i1", triage, new Date("2026-10-04T20:00:00Z"));
    return { ...f, res };
  }
  const patchOf = (calls: Call[]) => calls.find((c) => c[0] === "update")![1] as Record<string, unknown>;

  it("every action re-asserts the Inbox shape in its WHERE (a stale tap can't touch a triaged row)", async () => {
    for (const t of [{ kind: "plan", plannedDate: "2026-10-05" }, { kind: "task", area: "school" }, { kind: "worry" }, { kind: "done" }] as const) {
      const { calls } = await run(t);
      expect(calls).toContainEqual(["eq", "id", "i1"]);
      for (const c of INBOX_SHAPE) expect(calls).toContainEqual(c);
    }
  });

  it("plan → becomes the close's own dump line: dump_source note + the ceremony's planned_date", async () => {
    const { calls, res } = await run({ kind: "plan", plannedDate: "2026-10-05" });
    expect(res).toEqual({ ok: true });
    expect(patchOf(calls)).toEqual({ dump_source: "note", planned_date: "2026-10-05" });
  });

  it("task → school/co_op sets the domain and clears planned_date; never deletes", async () => {
    expect(patchOf((await run({ kind: "task", area: "school" })).calls)).toEqual({ domain: "school", planned_date: null });
    expect(patchOf((await run({ kind: "task", area: "co_op" })).calls)).toEqual({ domain: "co_op", planned_date: null });
  });

  it("worry → dump_source worry only (domain stays null, the worries list finds it by kind)", async () => {
    expect(patchOf((await run({ kind: "worry" })).calls)).toEqual({ dump_source: "worry" });
  });

  it("done → completed true with a completed_at (archive, not delete)", async () => {
    expect(patchOf((await run({ kind: "done" })).calls)).toEqual({ completed: true, completed_at: "2026-10-04T20:00:00.000Z" });
  });

  it("rejects bad input before any write", async () => {
    const bad1 = await run({ kind: "plan", plannedDate: "tomorrow" });
    expect(bad1.res).toEqual({ ok: false, error: "Bad plan date" });
    expect(bad1.calls.find((c) => c[0] === "update")).toBeUndefined();
    const bad2 = await run({ kind: "task", area: "business" as never });
    expect(bad2.res.ok).toBe(false);
    expect(bad2.calls.find((c) => c[0] === "update")).toBeUndefined();
  });

  it("an already-triaged item (0 rows changed) is an error, not a silent success", async () => {
    const { res } = await run({ kind: "done" }, { data: [], error: null });
    expect(res).toEqual({ ok: false, error: "That item was already sorted." });
  });

  it("surfaces a database error", async () => {
    const { res } = await run({ kind: "worry" }, { data: null, error: { message: "boom" } });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
