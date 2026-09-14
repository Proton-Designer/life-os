import { describe, expect, it, vi } from "vitest";
import { getUnfinishedMilestonesForMonth, getMilestonesForMonth, monthStartFor } from "../queries";

type Call = { method: string; args: unknown[] };

function makeSupabase(rows: unknown[], calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return { from: vi.fn(() => chain) };
}

describe("monthStartFor", () => {
  it("is pure string slicing, never a Date round-trip", () => {
    expect(monthStartFor("2026-09-14")).toBe("2026-09-01");
    expect(monthStartFor("2026-01-31")).toBe("2026-01-01");
    expect(monthStartFor("2026-12-01")).toBe("2026-12-01");
  });
});

describe("getUnfinishedMilestonesForMonth — #45's seeding query", () => {
  it("queries goal_milestones alone (no join), filtered to this user/month/unfinished", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase([{ id: "m1", goal_id: "g1", title: "Ship it" }], calls);
    const result = await getUnfinishedMilestonesForMonth(supabase as never, "user-1", "2026-09-01");

    expect(supabase.from).toHaveBeenCalledWith("goal_milestones");
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["month_start", "2026-09-01"]);
    const isArgs = calls.filter((c) => c.method === "is").map((c) => c.args);
    expect(isArgs).toContainEqual(["done_at", null]);
    expect(result).toEqual([{ id: "m1", goalId: "g1", title: "Ship it" }]);
  });
});

describe("getMilestonesForMonth — the Goals page's own read", () => {
  it("returns done and unfinished milestones both, unlike the seeding-only query above", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase(
      [
        { id: "m1", goal_id: "g1", title: "Ship it", done_at: null },
        { id: "m2", goal_id: "g2", title: "Already done", done_at: "2026-09-10T00:00:00Z" },
      ],
      calls
    );
    const result = await getMilestonesForMonth(supabase as never, "user-1", "2026-09-01");

    expect(supabase.from).toHaveBeenCalledWith("goal_milestones");
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["month_start", "2026-09-01"]);
    // Deliberately no `.is("done_at", null)` call — this query does not
    // filter by completion, unlike getUnfinishedMilestonesForMonth.
    expect(calls.some((c) => c.method === "is")).toBe(false);
    expect(result).toEqual([
      { id: "m1", goalId: "g1", title: "Ship it", doneAt: null },
      { id: "m2", goalId: "g2", title: "Already done", doneAt: "2026-09-10T00:00:00Z" },
    ]);
  });
});
