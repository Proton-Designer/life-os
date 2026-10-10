import { describe, expect, it } from "vitest";
import { planLineEffects, validatePlanLine, type PlanLineInput, type PlanLinePrev } from "../plan-details";

const prev = (over: Partial<PlanLinePrev> = {}): PlanLinePrev => ({ area: null, domain: null, dueDate: null, killListItemId: null, ...over });
const line = (over: Partial<PlanLineInput> = {}): PlanLineInput => ({ id: "t1", area: null, addToKillList: false, startTime: null, durationMinutes: null, order: 0, criteria: null, ...over });
const DAY = "2026-10-07";

describe("planLineEffects", () => {
  it("records timing, area and order on every line", () => {
    const e = planLineEffects(prev(), line({ area: "body", startTime: "07:00", durationMinutes: 45, order: 2 }), DAY);
    expect(e.patch).toMatchObject({ plan_area: "body", planned_start_time: "07:00", planned_duration_minutes: 45, plan_order: 2 });
    expect(e.wantKillList).toBe(false);
    expect(e.enterWorkBacklog).toBe(false);
  });
  it("writes trimmed criteria, and clears the column when there are none", () => {
    expect(planLineEffects(prev(), line({ criteria: "  all 12 problems, show work  " }), DAY).patch).toMatchObject({ plan_criteria: "all 12 problems, show work" });
    expect(planLineEffects(prev(), line({ criteria: null }), DAY).patch).toMatchObject({ plan_criteria: null });
  });
  it("School makes the line a School task for the plan day", () => {
    const e = planLineEffects(prev(), line({ area: "school" }), DAY);
    expect(e.patch).toMatchObject({ domain: "school", due_date: DAY, due_time: null });
  });
  it("leaving School undoes the School task shape", () => {
    const e = planLineEffects(prev({ area: "school", domain: "school", dueDate: DAY }), line({ area: "business", addToKillList: true }), DAY);
    expect(e.patch).toMatchObject({ domain: null, due_date: null });
  });
  it("a no-area line never touches domain/due_date", () => {
    const e = planLineEffects(prev(), line(), DAY);
    expect("domain" in e.patch).toBe(false);
    expect("due_date" in e.patch).toBe(false);
  });
  it("Business wants the Kill List only when checked", () => {
    expect(planLineEffects(prev(), line({ area: "business", addToKillList: true }), DAY).wantKillList).toBe(true);
    expect(planLineEffects(prev(), line({ area: "business", addToKillList: false }), DAY).wantKillList).toBe(false);
    expect(planLineEffects(prev(), line({ area: "work", addToKillList: true }), DAY).wantKillList).toBe(false);
  });
  it("unchecking the Kill List drops the pairing it made; staying checked keeps it", () => {
    expect(planLineEffects(prev({ area: "business", killListItemId: "k1" }), line({ area: "business", addToKillList: false }), DAY)).toMatchObject({ dropKillListItemId: "k1", patch: { kill_list_item_id: null } });
    expect(planLineEffects(prev({ area: "business", killListItemId: "k1" }), line({ area: "business", addToKillList: true }), DAY).dropKillListItemId).toBeNull();
    expect(planLineEffects(prev({ area: "business", killListItemId: "k1" }), line({ area: "work" }), DAY).dropKillListItemId).toBe("k1");
  });
  it("Work backlog fires only on entering Work", () => {
    expect(planLineEffects(prev(), line({ area: "work" }), DAY).enterWorkBacklog).toBe(true);
    expect(planLineEffects(prev({ area: "work" }), line({ area: "work" }), DAY).enterWorkBacklog).toBe(false);
  });
});

describe("validatePlanLine criteria", () => {
  it("accepts null and ordinary text", () => {
    expect(validatePlanLine(line({ criteria: null }))).toBeNull();
    expect(validatePlanLine(line({ criteria: "show work" }))).toBeNull();
  });
  it("rejects blank-only and over-long criteria", () => {
    expect(validatePlanLine(line({ criteria: "   " }))).not.toBeNull();
    expect(validatePlanLine(line({ criteria: "x".repeat(2001) }))).not.toBeNull();
    expect(validatePlanLine(line({ criteria: "x".repeat(2000) }))).toBeNull();
  });
});

describe("validatePlanLine", () => {
  it("accepts a clean line and rejects malformed input", () => {
    expect(validatePlanLine(line({ area: "business", startTime: "21:05", durationMinutes: 90 }))).toBeNull();
    expect(validatePlanLine(line({ area: "co_op" as never }))).not.toBeNull();
    expect(validatePlanLine(line({ startTime: "25:00" }))).not.toBeNull();
    expect(validatePlanLine(line({ startTime: "9:00" }))).not.toBeNull();
    expect(validatePlanLine(line({ durationMinutes: 0 }))).not.toBeNull();
    expect(validatePlanLine(line({ durationMinutes: 1441 }))).not.toBeNull();
    expect(validatePlanLine(line({ durationMinutes: 1.5 }))).not.toBeNull();
    expect(validatePlanLine(line({ order: -1 }))).not.toBeNull();
  });
});

describe("Work tab (plan_subdomain)", () => {
  it("keeps the tab on a Business or Work line and drops it from any other domain", () => {
    expect(planLineEffects(prev(), line({ area: "business", addToKillList: true, subdomain: "acme" }), DAY).patch).toMatchObject({ plan_subdomain: "acme" });
    expect(planLineEffects(prev(), line({ area: "work", subdomain: "day-job" }), DAY).patch).toMatchObject({ plan_subdomain: "day-job" });
    expect(planLineEffects(prev(), line({ area: "school", subdomain: "acme" }), DAY).patch).toMatchObject({ plan_subdomain: null });
    expect(planLineEffects(prev(), line({ area: null, subdomain: "acme" }), DAY).patch).toMatchObject({ plan_subdomain: null });
  });
  it("a Business tab line takes the Kill List route; a job tab line enters the Backlog", () => {
    const biz = planLineEffects(prev(), line({ area: "business", addToKillList: true, subdomain: "acme" }), DAY);
    expect(biz.wantKillList).toBe(true);
    expect(biz.enterWorkBacklog).toBe(false);
    const job = planLineEffects(prev(), line({ area: "work", subdomain: "day-job" }), DAY);
    expect(job.enterWorkBacklog).toBe(true);
    expect(job.wantKillList).toBe(false);
  });
  it("rejects an empty or over-long tab key", () => {
    expect(validatePlanLine(line({ area: "work", subdomain: "" }))).not.toBeNull();
    expect(validatePlanLine(line({ area: "work", subdomain: "x".repeat(81) }))).not.toBeNull();
    expect(validatePlanLine(line({ area: "work", subdomain: "acme" }))).toBeNull();
  });
});
