import { describe, expect, it } from "vitest";
import { composeDump, star, unstar, crown, rankedPlan, type DumpItem } from "../night-plan";

const seeded: DumpItem[] = [
  { id: "d1", title: "PHYS2326 problem set — due Thu", source: "school_risk" },
  { id: "d2", title: "Ship the onboarding copy", source: "goal_milestone" },
  { id: "d3", title: "Call the landlord back", source: "worry" },
];
const typed: DumpItem[] = [{ id: "u1", title: "Read chapter 4", source: "user" }];

describe("the crown is scarce, and scarcity is the mechanism", () => {
  // mit_rank is enforced in CollegeOS by a PARTIAL UNIQUE INDEX
  // (tasks_mit_rank_per_day_idx: unique on (user_id, planned_date, mit_rank) where
  // mit_rank is not null), not by a UI that only draws one button. That distinction
  // matters because the failure is silent: two crowned items still render perfectly,
  // and the day simply stops having a single most-important thing. The engine holds
  // the same invariant so it is true before any row is written.
  it("crowning a second item moves the crown; it never yields two", () => {
    let s = composeDump(seeded, []);
    s = star(s, "d1");
    s = star(s, "d2");
    s = crown(s, "d1");
    s = crown(s, "d2");

    const plan = rankedPlan(s);
    expect(plan.filter((i) => i.rank === 1)).toHaveLength(1);
    expect(plan.find((i) => i.rank === 1)!.id).toBe("d2");
    expect(plan.find((i) => i.id === "d1")!.rank).toBe(2);
  });

  it("refuses to crown something that was never starred — the order IS the ritual", () => {
    let s = composeDump(seeded, []);
    s = crown(s, "d3");
    expect(rankedPlan(s).every((i) => i.id !== "d3")).toBe(true);
  });

  it("stars at most three; a fourth is refused rather than silently dropping one", () => {
    let s = composeDump([...seeded, ...typed], []);
    s = star(s, "d1");
    s = star(s, "d2");
    s = star(s, "d3");
    const before = rankedPlan(s);
    s = star(s, "u1");
    expect(rankedPlan(s)).toEqual(before);
  });
});

describe("seeding is one-shot; removing a seeded item is a planning act", () => {
  it("a removed seed does not come back when the dump is recomposed", () => {
    const first = composeDump(seeded, []);
    expect(first.items.some((i) => i.id === "d2")).toBe(true);

    // The user removes the seeded milestone: not tomorrow's problem. The caller
    // persists that decision as a dismissal -- which is the whole point, because a
    // dump that re-seeds on every open makes removal meaningless and turns a plan
    // into a feed.
    const dismissed = ["d2"];
    const reopened = composeDump(seeded, dismissed);
    expect(reopened.items.some((i) => i.id === "d2")).toBe(false);
    expect(reopened.items).toHaveLength(2);
  });

  it("dismissing every seed is a legitimate empty dump, not an error state", () => {
    const s = composeDump(seeded, ["d1", "d2", "d3"]);
    expect(s.items).toEqual([]);
    expect(rankedPlan(s)).toEqual([]);
  });
});

describe("what the dump must never carry", () => {
  // Duration calibration trains on estimate-vs-actual pairs. A dump that injects
  // estimates nobody made poisons that signal, and the arbiter's `cost` factor reads
  // it downstream. So a dumped item has no estimate field at all -- absence enforced
  // by shape, not by remembering not to set it.
  it("a dumped item carries no duration estimate", () => {
    const s = composeDump(seeded, []);
    for (const item of s.items) {
      expect(item).not.toHaveProperty("estimatedMinutes");
    }
  });

  // Forty dumped cards destroys a two-minute ritual; "14 cards, ~8 min" is context.
  it("due retrieval items arrive as a count, never as dumped rows", () => {
    const s = composeDump(seeded, [], { dueRetrievalCount: 14 });
    expect(s.dueRetrievalCount).toBe(14);
    expect(s.items).toHaveLength(3);
  });
});
