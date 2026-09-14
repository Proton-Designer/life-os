import { describe, expect, it, vi } from "vitest";
import { getCompletedBusinessGoals } from "../completed-goals";

type Call = { method: string; args: unknown[] };

function makeSupabase(rows: unknown[], calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return { from: vi.fn(() => chain) };
}

describe("getCompletedBusinessGoals (#53) — reads goals, not weekly_goals", () => {
  it("filters to this user, domain='business', status='done'", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase(
      [{ id: "g1", title: "Ship the thing", completed_at: "2026-09-10T12:00:00Z" }],
      calls
    );
    const result = await getCompletedBusinessGoals(supabase as never, "user-1");

    expect(supabase.from).toHaveBeenCalledWith("goals");
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["domain", "business"]);
    expect(eqArgs).toContainEqual(["status", "done"]);
    expect(result).toEqual([{ id: "g1", title: "Ship the thing", completedDateStr: "2026-09-10" }]);
  });

  it("drops any row missing completed_at rather than crash on the date slice", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase([{ id: "g1", title: "Weird row", completed_at: null }], calls);
    const result = await getCompletedBusinessGoals(supabase as never, "user-1");
    expect(result).toEqual([]);
  });
});
