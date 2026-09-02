import { describe, expect, it } from "vitest";
import { selectNextActionPerDomain } from "../next-actions";
import type { AreaWeightLookup } from "../build-candidates";
import type { PriorityItem } from "../types";

function item(overrides: Partial<PriorityItem>): PriorityItem {
  return {
    id: "id",
    domain: "deen",
    title: "title",
    dueAt: null,
    windowEndAt: null,
    date: "2026-08-17",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_prayer",
    actionRefId: "ref",
    cost: null,
    ...overrides,
  };
}

const now = new Date("2026-08-17T12:00:00.000Z");
const noWeights: AreaWeightLookup = {};

describe("selectNextActionPerDomain", () => {
  it("returns empty output for empty input", () => {
    expect(selectNextActionPerDomain([], noWeights, now)).toEqual([]);
  });

  it("picks one item per domain present", () => {
    const items = [
      item({ id: "d1", domain: "deen" }),
      item({ id: "b1", domain: "business" }),
      item({ id: "f1", domain: "fitness" }),
    ];
    const result = selectNextActionPerDomain(items, noWeights, now);
    expect(result.map((i) => i.id)).toHaveLength(3);
    expect(new Set(result.map((i) => i.domain))).toEqual(new Set(["deen", "business", "fitness"]));
  });

  it("omits domains with no pending item", () => {
    const items = [item({ id: "d1", domain: "deen" }), item({ id: "s1", domain: "school" })];
    const result = selectNextActionPerDomain(items, noWeights, now);
    expect(result.map((i) => i.domain)).toEqual(["deen", "school"]);
  });

  it("picks the first (most urgent) item when a domain has several", () => {
    const items = [
      item({ id: "fajr", domain: "deen", title: "Fajr" }),
      item({ id: "isha", domain: "deen", title: "Isha" }),
    ];
    const result = selectNextActionPerDomain(items, noWeights, now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fajr");
  });

  it("does not mutate or re-sort within a domain", () => {
    const items = [
      item({ id: "b1", domain: "business" }),
      item({ id: "d2", domain: "deen", title: "second" }),
      item({ id: "d1", domain: "deen", title: "first" }),
    ];
    const result = selectNextActionPerDomain(items, noWeights, now);
    const deen = result.find((i) => i.domain === "deen");
    expect(deen?.id).toBe("d2");
  });

  // Live bug (Boss ruling, R7 task 1, fixed originally in fc39d2a):
  // getPriorityItems computes a real urgency bucket per domain and sorts
  // by it -- this function must never throw that sort away for a fixed
  // domain order. Both Business and School/co_op render through the same
  // taskable list in next-actions.tsx (Fitness alone is structurally
  // segregated into its own row below).
  it("ranks a School item due in 20 minutes above a Business item with no due time at all", () => {
    const items = [
      item({ id: "b1", domain: "business", title: "Call the landlord", dueAt: null, urgencyBucket: "later_today" }),
      item({
        id: "s1",
        domain: "school",
        title: "Essay due",
        dueAt: new Date(now.getTime() + 20 * 60 * 1000),
        urgencyBucket: "right_now",
      }),
    ];
    const result = selectNextActionPerDomain(items, noWeights, now);
    expect(result.map((i) => i.id)).toEqual(["s1", "b1"]);
  });

  // A2 wiring: real weight data now breaks ties -- no fixed domain array
  // left to fall back to. Both items are tied on urgency/dueAt (both
  // absent), so weight tier decides.
  it("weight tier breaks a tie between two domains with no due date at all -- real data, not a fixed array", () => {
    const items = [
      item({ id: "b1", domain: "business", title: "Kill list item", dueAt: null }),
      item({ id: "d1", domain: "deen", title: "Reflection", dueAt: null }),
    ];
    const weights: AreaWeightLookup = {
      deen: { weightTier: "essential", position: 0 },
      business: { weightTier: "background", position: 0 },
    };

    const result = selectNextActionPerDomain(items, weights, now);

    expect(result.map((i) => i.id)).toEqual(["d1", "b1"]);
  });

  // Business/co_op have no counterpart in the onboarding vocabulary today
  // (build-candidates.ts's own documented gap) -- an empty weights lookup
  // must not crash or silently invent a tier for them.
  it("an area missing from the weights lookup falls to the arbiter's 'important' floor, never a crash or a guessed tier", () => {
    const items = [item({ id: "b1", domain: "business", dueAt: null })];
    expect(() => selectNextActionPerDomain(items, {}, now)).not.toThrow();
    expect(selectNextActionPerDomain(items, {}, now).map((i) => i.id)).toEqual(["b1"]);
  });
});
