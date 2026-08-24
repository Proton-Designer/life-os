import { describe, expect, it } from "vitest";
import { isReviewOpen, mustRewrite, rankTriggersForCapture, rankTriggersForPlanList, reviewDateFor } from "../plan-rules";
import type { TriggerSummary } from "../types";

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "t1",
    domain: "deen",
    name: "Trigger",
    description: null,
    totalCount: 0,
    todayCount: 0,
    lastOccurredAtIso: null,
    createdDate: "2026-08-01",
    currentPlan: null,
    ...overrides,
  };
}

describe("mustRewrite", () => {
  it("false with zero triggers/outcomes", () => {
    expect(mustRewrite(0, 0)).toBe(false);
  });

  it("false with 3 skips and 1 follow — ever followed means never force-rewritten", () => {
    expect(mustRewrite(1, 3)).toBe(false);
  });

  it("false at exactly 2 skips with zero follows", () => {
    expect(mustRewrite(0, 2)).toBe(false);
  });

  it("true at exactly 3 skips with zero follows", () => {
    expect(mustRewrite(0, 3)).toBe(true);
  });

  it("true beyond 3 skips with zero follows", () => {
    expect(mustRewrite(0, 5)).toBe(true);
  });
});

describe("rankTriggersForCapture", () => {
  it("returns empty for zero triggers", () => {
    expect(rankTriggersForCapture([])).toEqual([]);
  });

  it("sorts by totalCount desc", () => {
    const a = trigger({ id: "a", totalCount: 1 });
    const b = trigger({ id: "b", totalCount: 5 });
    expect(rankTriggersForCapture([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("ties on totalCount break by lastOccurredAt desc", () => {
    const a = trigger({ id: "a", totalCount: 2, lastOccurredAtIso: "2026-08-01T00:00:00Z" });
    const b = trigger({ id: "b", totalCount: 2, lastOccurredAtIso: "2026-08-05T00:00:00Z" });
    expect(rankTriggersForCapture([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("ties on both totalCount and lastOccurredAt break by name asc", () => {
    const a = trigger({ id: "a", name: "Zebra", totalCount: 2, lastOccurredAtIso: null });
    const b = trigger({ id: "b", name: "Apple", totalCount: 2, lastOccurredAtIso: null });
    expect(rankTriggersForCapture([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("rankTriggersForPlanList", () => {
  it("excludes triggers with no current plan", () => {
    const withPlan = trigger({
      id: "a",
      currentPlan: { id: "p1", body: "x", version: 1, createdAtIso: "2026-08-01T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false },
    });
    const withoutPlan = trigger({ id: "b", currentPlan: null });
    expect(rankTriggersForPlanList([withPlan, withoutPlan]).map((t) => t.id)).toEqual(["a"]);
  });

  it("sorts remaining triggers by lastOccurredAt desc", () => {
    const plan = { id: "p1", body: "x", version: 1, createdAtIso: "2026-08-01T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false };
    const a = trigger({ id: "a", currentPlan: plan, lastOccurredAtIso: "2026-08-01T00:00:00Z" });
    const b = trigger({ id: "b", currentPlan: plan, lastOccurredAtIso: "2026-08-05T00:00:00Z" });
    expect(rankTriggersForPlanList([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("isReviewOpen", () => {
  it("false at 20:59 (just before the 9 PM open)", () => {
    const now = new Date("2026-08-23T20:59:00-05:00");
    expect(isReviewOpen(now, "America/Chicago")).toBe(false);
  });

  it("true at exactly 21:00", () => {
    const now = new Date("2026-08-23T21:00:00-05:00");
    expect(isReviewOpen(now, "America/Chicago")).toBe(true);
  });

  it("true at 00:30 — the post-midnight tail, a realistic hour to actually open it", () => {
    const now = new Date("2026-08-24T00:30:00-05:00");
    expect(isReviewOpen(now, "America/Chicago")).toBe(true);
  });

  it("false at exactly 04:00 — the tail has closed", () => {
    const now = new Date("2026-08-24T04:00:00-05:00");
    expect(isReviewOpen(now, "America/Chicago")).toBe(false);
  });

  it("respects a different timezone than the machine's", () => {
    // Same instant: 15:00 Chicago (CDT, UTC-5) is 21:00 London (BST, UTC+1) in August.
    const now = new Date("2026-08-23T15:00:00-05:00");
    expect(isReviewOpen(now, "America/Chicago")).toBe(false);
    expect(isReviewOpen(now, "Europe/London")).toBe(true);
  });
});

describe("reviewDateFor", () => {
  it("targets today at 21:00", () => {
    const now = new Date("2026-08-23T21:00:00-05:00");
    expect(reviewDateFor(now, "America/Chicago")).toBe("2026-08-23");
  });

  it("targets YESTERDAY at 00:30 — the triggers logged before midnight, not an empty new day", () => {
    const now = new Date("2026-08-24T00:30:00-05:00");
    expect(reviewDateFor(now, "America/Chicago")).toBe("2026-08-23");
  });

  it("still targets yesterday right at the 04:00 boundary's edge (03:59)", () => {
    const now = new Date("2026-08-24T03:59:00-05:00");
    expect(reviewDateFor(now, "America/Chicago")).toBe("2026-08-23");
  });
});
