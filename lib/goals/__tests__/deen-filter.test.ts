import { describe, expect, it, vi } from "vitest";
import { withoutDeenGoals } from "../deen-filter";
import { getUnfinishedMilestonesForMonth, getDeenGoalIdsForMonth } from "../queries";

const GOALS = [
  { id: "g1", domain: "deen", title: "Pray Fajr on time" },
  { id: "g2", domain: "business", title: "Ship" },
  { id: "g3", domain: null, title: "Untagged" },
];

describe("withoutDeenGoals", () => {
  it("OFF drops goals tagged deen and keeps everything else", () => {
    expect(withoutDeenGoals(GOALS, false).map((g) => g.id)).toEqual(["g2", "g3"]);
  });
  it("ON (positive control) keeps all goals untouched", () => {
    expect(withoutDeenGoals(GOALS, true)).toEqual(GOALS);
  });
});

describe("Night Plan milestone seeds", () => {
  function client(rows: { id: string; goal_id: string; title: string }[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return { from: vi.fn(() => chain) } as never;
  }
  const ROWS = [
    { id: "m1", goal_id: "g1", title: "Pray daily" },
    { id: "m2", goal_id: "g2", title: "Ship v1" },
  ];

  it("excludes milestones of the given goal ids; none excluded = unchanged", async () => {
    expect((await getUnfinishedMilestonesForMonth(client(ROWS), "u", "2026-10-01", new Set(["g1"]))).map((m) => m.id)).toEqual(["m2"]);
    expect((await getUnfinishedMilestonesForMonth(client(ROWS), "u", "2026-10-01")).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("getDeenGoalIdsForMonth returns the deen goal ids", async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "g1" }], error: null });
    const ids = await getDeenGoalIdsForMonth({ from: vi.fn(() => chain) } as never, "u", "2026-10-01");
    expect([...ids]).toEqual(["g1"]);
    expect((chain.eq as ReturnType<typeof vi.fn>).mock.calls).toContainEqual(["domain", "deen"]);
  });
});
