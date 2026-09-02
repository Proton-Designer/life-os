import { describe, expect, it } from "vitest";
import { buildCandidatesFromPriorityItems, buildSelfMasteryCandidate, type AreaWeightLookup } from "../build-candidates";
import { rankCandidates } from "../arbiter";
import type { PriorityItem } from "../types";

function priorityItem(overrides: Partial<PriorityItem> & Pick<PriorityItem, "id" | "domain">): PriorityItem {
  return {
    title: overrides.id,
    dueAt: null,
    windowEndAt: null,
    date: "2026-09-02",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_task",
    actionRefId: overrides.id,
    cost: null,
    ...overrides,
  };
}

describe("buildCandidatesFromPriorityItems", () => {
  it("carries id/area/title/dueAt/cost straight through", () => {
    const dueAt = new Date("2026-09-02T13:00:00Z");
    const items = [priorityItem({ id: "task-1", domain: "school", title: "Essay due", dueAt, cost: null })];

    const [candidate] = buildCandidatesFromPriorityItems(items, {});

    expect(candidate).toMatchObject({ id: "task-1", area: "school", title: "Essay due", dueAt, cost: null });
  });

  it("resolves weightTier/position from the lookup for an area that has one", () => {
    const items = [priorityItem({ id: "prayer-fajr", domain: "deen" })];
    const weights: AreaWeightLookup = { deen: { weightTier: "essential", position: 0 } };

    const [candidate] = buildCandidatesFromPriorityItems(items, weights);

    expect(candidate.weightTier).toBe("essential");
    expect(candidate.position).toBe(0);
  });

  // The Lead's own ask: named, not incidental -- proves the real gap
  // (Business/co_op have no counterpart in the onboarding vocabulary,
  // see build-candidates.ts's own AreaWeightLookup comment) produces the
  // arbiter's honest floor, never a guessed tier, and stays provably true
  // even once ranked against a candidate that DOES have a real tier.
  it("Business and co_op get weightTier: null (no source), never a guessed tier -- and rank on the 'important' floor, not silently promoted or demoted", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const killList = priorityItem({ id: "kill-list", domain: "business" });
    const coopTask = priorityItem({ id: "coop-1", domain: "co_op" });
    // No entry for "business" or "co_op" in the lookup at all -- not even
    // an explicit null value, matching what a real caller has today.
    const weights: AreaWeightLookup = { deen: { weightTier: "essential", position: 0 } };

    const [killListCandidate, coopCandidate] = buildCandidatesFromPriorityItems([killList, coopTask], weights);

    expect(killListCandidate.weightTier).toBeNull();
    expect(coopCandidate.weightTier).toBeNull();

    // Ranked against a real 'background' tier candidate (worse than the
    // 'important' floor) and a real 'essential' one (better than it) --
    // proves the null resolves to the floor's actual position, not just
    // that the field reads null in isolation.
    const background = priorityItem({ id: "background-item", domain: "fitness" });
    const backgroundWeights: AreaWeightLookup = { ...weights, fitness: { weightTier: "background", position: 0 } };
    const allCandidates = buildCandidatesFromPriorityItems([killList, coopTask, background], backgroundWeights);
    const ranked = rankCandidates(allCandidates, now);

    // important (null-floor) beats background; nothing here ever promotes
    // Business/co_op to essential or demotes them below background --
    // that would require inventing a tier this lookup was never given.
    expect(ranked.map((c) => c.id)).toEqual(["kill-list", "coop-1", "background-item"]);
  });

  it("cost passes through unchanged (real for Fitness, null everywhere else -- decided upstream by getPriorityItems, not here)", () => {
    const items = [priorityItem({ id: "fitness-today", domain: "fitness", cost: 45 })];

    const [candidate] = buildCandidatesFromPriorityItems(items, {});

    expect(candidate.cost).toBe(45);
  });

  it("decay is always null -- no domain reachable through PriorityItem has a decay source (R18(2))", () => {
    const items = [priorityItem({ id: "prayer-fajr", domain: "deen" }), priorityItem({ id: "fitness-today", domain: "fitness" })];

    const candidates = buildCandidatesFromPriorityItems(items, {});

    expect(candidates.every((c) => c.decay === null)).toBe(true);
  });
});

describe("buildSelfMasteryCandidate", () => {
  it("returns null -- no candidate -- when there is genuinely nothing to offer, not a zero-scored placeholder", () => {
    const result = buildSelfMasteryCandidate({ dueAt: null, decay: null, cost: null, hasCandidate: false }, {});
    expect(result).toBeNull();
  });

  it("builds a real candidate with the earliest due card's dueAt, lowest-retrievability decay, and session cost", () => {
    const dueAt = new Date("2026-09-01T12:00:00Z");
    const result = buildSelfMasteryCandidate({ dueAt, decay: 0.35, cost: 8, hasCandidate: true }, {});

    expect(result).toMatchObject({ area: "self_mastery", dueAt, decay: 0.35, cost: 8 });
  });

  it("a fresh, never-touched deck (real cards, no due_at yet) is still a real candidate -- hasCandidate is independent of dueAt being null", () => {
    const result = buildSelfMasteryCandidate({ dueAt: null, decay: 0.5, cost: 8, hasCandidate: true }, {});
    expect(result).not.toBeNull();
    expect(result?.dueAt).toBeNull();
  });

  it("resolves weightTier/position from the lookup's self_mastery entry when present", () => {
    const weights: AreaWeightLookup = { self_mastery: { weightTier: "essential", position: 1 } };
    const result = buildSelfMasteryCandidate({ dueAt: null, decay: null, cost: null, hasCandidate: true }, weights);

    expect(result?.weightTier).toBe("essential");
    expect(result?.position).toBe(1);
  });

  it("is weightTier: null (the same honest gap as Business/co_op) when the lookup has no self_mastery entry", () => {
    const result = buildSelfMasteryCandidate({ dueAt: null, decay: null, cost: null, hasCandidate: true }, {});
    expect(result?.weightTier).toBeNull();
  });
});
