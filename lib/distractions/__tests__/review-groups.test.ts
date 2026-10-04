import { describe, expect, it } from "vitest";
import { buildReviewGroups } from "../review-groups";
import type { TriggerSummary } from "../types";

const t = (over: Partial<TriggerSummary>): TriggerSummary => ({
  id: "t",
  domain: "school",
  name: "Phone",
  description: null,
  totalCount: 1,
  todayCount: 1,
  lastOccurredAtIso: "2026-10-04T10:00:00Z",
  createdDate: "2026-10-01",
  currentPlan: { id: "p", body: "x", version: 1, createdAtIso: "2026-10-01T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false },
  ...over,
});

describe("buildReviewGroups (IA-P1b: the one review list)", () => {
  it("keeps only triggers with an event today, in spec order, omitting empty domains", () => {
    const groups = buildReviewGroups([
      t({ id: "a", domain: "co_op" }),
      t({ id: "b", domain: "deen" }),
      t({ id: "c", domain: "school", todayCount: 0 }),
      t({ id: "d", domain: "business" }),
    ]);
    expect(groups.map((g) => g.domain)).toEqual(["deen", "business", "co_op"]);
  });
  it("marks plan-less triggers isNew and carries todayCount", () => {
    const [g] = buildReviewGroups([t({ id: "a", currentPlan: null, todayCount: 3 })]);
    expect(g.items[0]).toMatchObject({ isNew: true, todayCount: 3 });
    expect(buildReviewGroups([t({})])[0].items[0].isNew).toBe(false);
  });
  it("is empty when nothing happened today (positive control: the same trigger with todayCount 1 yields a group)", () => {
    expect(buildReviewGroups([t({ todayCount: 0 })])).toEqual([]);
    expect(buildReviewGroups([t({ todayCount: 1 })])).toHaveLength(1);
  });
});
