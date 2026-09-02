import { describe, expect, it } from "vitest";
import { nextStage, planStep, type PlanProgress } from "../close-stages";
import type { NightPlanState } from "@/lib/night-plan/night-plan";

const state = (over: Partial<NightPlanState> = {}): NightPlanState => ({
  items: [],
  starred: [],
  crowned: null,
  dueRetrievalCount: 0,
  ...over,
});

// DumpItem's field is `title`, not `text`. vitest strips types, so this
// fixture RAN and passed while tsc rejected it — a green that agreed with a
// wrong shape. Caught by the typecheck, not the suite.
const item = (id: string) => ({ id, title: id, source: "user" as const });

describe("evening close — stage order is the mechanism, not a UI flow", () => {
  it("account comes first, and a forced rewrite holds it there", () => {
    expect(nextStage("account", { blocked: true, plan: state() })).toBe("account");
  });

  it("account gives way to reflect once nothing is refusing", () => {
    expect(nextStage("account", { blocked: false, plan: state() })).toBe("reflect");
  });

  it("reflect gives way to plan", () => {
    expect(nextStage("reflect", { blocked: false, plan: state() })).toBe("plan");
  });

  // The close is only finished when the plan stage is finished. Advancing off
  // "plan" while nothing is crowned would end the ceremony with no most
  // important thing — the exact outcome the crown exists to prevent.
  it("plan does not complete until something is crowned", () => {
    const dumped = state({ items: [item("a"), item("b")], starred: ["a"], crowned: null });
    expect(nextStage("plan", { blocked: false, plan: dumped })).toBe("plan");
  });

  it("plan completes once a crown exists", () => {
    const done = state({ items: [item("a")], starred: ["a"], crowned: "a" });
    expect(nextStage("plan", { blocked: false, plan: done })).toBe("done");
  });

  /**
   * A forced rewrite discovered late must not be escapable by having already
   * walked past the account stage. The gate is a property of the night, not a
   * screen you get through once.
   */
  it("a blocker sends any later stage back to account", () => {
    expect(nextStage("reflect", { blocked: true, plan: state() })).toBe("account");
    expect(nextStage("plan", { blocked: true, plan: state() })).toBe("account");
  });
});

/**
 * SPEC §2: "Dump → star three → crown one. Crowning is a SEPARATE ACT from
 * starring. Collapsing them into 'pick your top item' loses the two-stage
 * narrowing that makes the crown cost something."
 *
 * planStep names which of the three the user is actually on, so the surface
 * cannot render a crown affordance next to an unstarred line and quietly
 * become "pick your top item".
 */
describe("plan step — the two-stage narrowing is explicit", () => {
  it("an empty dump is on the dump step", () => {
    expect(planStep(state())).toBe("dump");
  });

  it("items with nothing starred is on the star step", () => {
    expect(planStep(state({ items: [item("a"), item("b")] }))).toBe("star");
  });

  it("starred but uncrowned is on the crown step", () => {
    expect(planStep(state({ items: [item("a")], starred: ["a"] }))).toBe("crown");
  });

  it("crowned is complete", () => {
    expect(planStep(state({ items: [item("a")], starred: ["a"], crowned: "a" }))).toBe("complete");
  });

  /**
   * An empty dump is a legitimate night, not an error — 6e33970 already
   * established that dismissing every seed is valid. It simply cannot reach a
   * crown, so the close ends without one rather than refusing to end.
   */
  it("a deliberately empty dump can complete the plan step", () => {
    const emptied: PlanProgress = { blocked: false, plan: state({ items: [] }) };
    expect(nextStage("plan", emptied)).toBe("done");
  });
});
