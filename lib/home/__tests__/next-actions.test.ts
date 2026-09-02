import { describe, expect, it } from "vitest";
import { NEXT_ACTION_ORDER, selectNextActionPerDomain } from "../next-actions";
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

describe("selectNextActionPerDomain", () => {
  it("returns empty output for empty input", () => {
    expect(selectNextActionPerDomain([])).toEqual([]);
  });

  it("picks one item per domain present", () => {
    const items = [
      item({ id: "d1", domain: "deen" }),
      item({ id: "b1", domain: "business" }),
      item({ id: "f1", domain: "fitness" }),
    ];
    const result = selectNextActionPerDomain(items);
    expect(result.map((i) => i.id)).toEqual(["d1", "b1", "f1"]);
  });

  it("omits domains with no pending item", () => {
    const items = [item({ id: "d1", domain: "deen" }), item({ id: "s1", domain: "school" })];
    const result = selectNextActionPerDomain(items);
    expect(result.map((i) => i.domain)).toEqual(["deen", "school"]);
  });

  it("orders output by NEXT_ACTION_ORDER regardless of input order", () => {
    const items = [
      item({ id: "c1", domain: "co_op" }),
      item({ id: "f1", domain: "fitness" }),
      item({ id: "d1", domain: "deen" }),
      item({ id: "s1", domain: "school" }),
      item({ id: "b1", domain: "business" }),
    ];
    const result = selectNextActionPerDomain(items);
    expect(result.map((i) => i.domain)).toEqual(NEXT_ACTION_ORDER);
  });

  it("picks the first (most urgent) item when a domain has several", () => {
    const items = [
      item({ id: "fajr", domain: "deen", title: "Fajr" }),
      item({ id: "isha", domain: "deen", title: "Isha" }),
    ];
    const result = selectNextActionPerDomain(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fajr");
  });

  it("does not mutate or re-sort within a domain", () => {
    const items = [
      item({ id: "b1", domain: "business" }),
      item({ id: "d2", domain: "deen", title: "second" }),
      item({ id: "d1", domain: "deen", title: "first" }),
    ];
    const result = selectNextActionPerDomain(items);
    const deen = result.find((i) => i.domain === "deen");
    expect(deen?.id).toBe("d2");
  });

  // Live bug (Boss ruling, R7 task 1): getPriorityItems computes a real
  // urgency bucket per domain and sorts by it, but this function threw that
  // sort away and walked a hardcoded domain order instead. Both Business
  // and School/co_op render through the same taskable list in
  // next-actions.tsx (Fitness alone is structurally segregated into its
  // own row below, so a Fitness-vs-School version of this test would not
  // reproduce anything real) — so a kill-list item with no due time at all
  // rendered above a School/co_op deadline due in 20 minutes, because
  // "business" sits before "school" in NEXT_ACTION_ORDER regardless of
  // urgency.
  it("ranks a School item due in 20 minutes above a Business item with no due time at all", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
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
    const result = selectNextActionPerDomain(items);
    expect(result.map((i) => i.id)).toEqual(["s1", "b1"]);
  });
});
