import { describe, expect, it } from "vitest";
import { savePlanRanksCore } from "../plan-actions-core";

/** Records every update(); awaiting any chain resolves to { data: [{id}], error: null }. */
function fake() {
  const updates: unknown[] = [];
  const client = {
    from() {
      const b: Record<string, unknown> = {};
      b.update = (p: unknown) => {
        updates.push(p);
        return b;
      };
      for (const n of ["eq", "not", "select"]) b[n] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "x" }], error: null }).then(ok);
      return b;
    },
  };
  return { client: client as never, updates };
}

describe("savePlanRanksCore", () => {
  it("an empty rank set is a no-op by default (the MCP tool's contract)", async () => {
    const f = fake();
    expect(await savePlanRanksCore(f.client, "u", "2026-10-07", [], null)).toEqual({ ok: true });
    expect(f.updates).toEqual([]);
  });

  it("saving an empty plan (Edit Plan with nothing starred) clears the day's old ranks when asked", async () => {
    const f = fake();
    const res = await savePlanRanksCore(f.client, "u", "2026-10-07", [], null, { clearWhenEmpty: true });
    expect(res).toEqual({ ok: true });
    expect(f.updates).toEqual([{ mit_rank: null }]);
  });

  it("a ranked plan clears once, then sets each rank", async () => {
    const f = fake();
    await savePlanRanksCore(f.client, "u", "2026-10-07", ["a", "b"], "a");
    expect(f.updates).toEqual([{ mit_rank: null }, { mit_rank: 1 }, { mit_rank: 2 }]);
  });
});
