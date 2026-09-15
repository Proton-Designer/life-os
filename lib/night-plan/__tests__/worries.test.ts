import { describe, expect, it, vi } from "vitest";
import { getOpenWorries, getHandledWorries, worriesToDumpItems } from "../worries";

type Call = { method: string; args: unknown[] };

function makeSupabase(rows: unknown[], calls: Call[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return { from: vi.fn(() => chain) };
}

describe("worry queries — item #42's actual fix", () => {
  it("getOpenWorries filters by dump_source=worry and completed=false, and NEVER by planned_date", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase(
      [{ id: "w1", title: "X", created_at: "t", completed: false, completed_at: null, worry_outcome: null }],
      calls
    );
    const result = await getOpenWorries(supabase as never, "user-1");

    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["dump_source", "worry"]);
    expect(eqArgs).toContainEqual(["completed", false]);
    // THE BUG THIS FIXES: the close's own tomorrowRows query filters
    // .eq("planned_date", tomorrow); a worry dumped with planned_date=today
    // never matched it. This query must carry no planned_date filter at all.
    expect(eqArgs.some(([field]) => field === "planned_date")).toBe(false);
    expect(result).toHaveLength(1);
  });

  it("P2-12: getHandledWorries maps a recorded worry_outcome onto Worry.outcome", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase(
      [{ id: "w1", title: "X", created_at: "t", completed: true, completed_at: "t2", worry_outcome: "took_action" }],
      calls
    );
    const [result] = await getHandledWorries(supabase as never, "user-1");
    expect(result.outcome).toBe("took_action");
  });

  it("getHandledWorries filters completed=true, ordered most-recent-first", async () => {
    const calls: Call[] = [];
    const supabase = makeSupabase([], calls);
    await getHandledWorries(supabase as never, "user-1");
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["completed", true]);
    const orderArgs = calls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orderArgs).toContainEqual(["completed_at", { ascending: false }]);
  });

  it("worriesToDumpItems adapts into the Night Plan engine's shape with source 'worry'", () => {
    const items = worriesToDumpItems([
      { id: "w1", title: "Call the landlord", createdAt: "t", completed: false, completedAt: null, outcome: null },
    ]);
    expect(items).toEqual([{ id: "w1", title: "Call the landlord", source: "worry" }]);
  });
});
