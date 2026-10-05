import { describe, expect, it } from "vitest";
import { pickRehearsalPlan } from "../rehearsal";
import type { TriggerSummary } from "../types";

const plan = (body: string, over: Partial<NonNullable<TriggerSummary["currentPlan"]>> = {}) => ({
  id: "p", body, version: 1, createdAtIso: "2026-10-01T00:00:00Z", followedCount: 0, skippedCount: 0, mustRewrite: false, ...over,
});
const t = (name: string, over: Partial<TriggerSummary> = {}): TriggerSummary => ({
  id: name, domain: "business", name, description: null, totalCount: 0, todayCount: 0, lastOccurredAtIso: null, createdDate: "2026-09-01", currentPlan: plan(`plan for ${name}`), ...over,
});

describe("pickRehearsalPlan", () => {
  it("takes the planned trigger that hit hardest yesterday", () => {
    const out = pickRehearsalPlan([t("phone", { todayCount: 1, totalCount: 9 }), t("email", { todayCount: 3, totalCount: 4 })]);
    expect(out).toMatchObject({ trigger: "email", body: "plan for email", yesterdayCount: 3 });
  });

  it("a clean yesterday falls back to the most frequent overall (yesterdayCount 0)", () => {
    const out = pickRehearsalPlan([t("phone", { totalCount: 9 }), t("email", { totalCount: 4 })]);
    expect(out).toMatchObject({ trigger: "phone", yesterdayCount: 0 });
  });

  it("skips triggers with no plan, a blank plan, or a plan that must be rewritten", () => {
    const out = pickRehearsalPlan([
      t("noplan", { todayCount: 9, totalCount: 9, currentPlan: null }),
      t("blank", { todayCount: 8, totalCount: 8, currentPlan: plan("   ") }),
      t("stuck", { todayCount: 7, totalCount: 7, currentPlan: plan("x", { skippedCount: 3, mustRewrite: true }) }),
      t("ok", { todayCount: 1, totalCount: 1 }),
    ]);
    expect(out?.trigger).toBe("ok");
  });

  it("nothing to rehearse -> null (no planned trigger, or planned but it never happened)", () => {
    expect(pickRehearsalPlan([])).toBeNull();
    expect(pickRehearsalPlan([t("a", { currentPlan: null, todayCount: 2 })])).toBeNull();
    expect(pickRehearsalPlan([t("never")])).toBeNull();
  });
});
