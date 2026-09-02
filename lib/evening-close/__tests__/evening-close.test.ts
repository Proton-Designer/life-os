import { describe, expect, it } from "vitest";
import { closeBlockers, canCompleteClose, type CloseInput } from "../evening-close";
import type { TriggerSummary, ActionPlan } from "@/lib/distractions/types";

const plan = (over: Partial<ActionPlan> = {}): ActionPlan => ({
  id: "p1",
  body: "Put the phone in the other room",
  version: 1,
  createdAtIso: "2026-08-25T02:00:00.000Z",
  followedCount: 0,
  skippedCount: 0,
  mustRewrite: false,
  ...over,
});

const trigger = (over: Partial<TriggerSummary> = {}): TriggerSummary => ({
  id: "t1",
  domain: "business",
  name: "Phone during deep work",
  description: null,
  totalCount: 5,
  todayCount: 1,
  lastOccurredAtIso: "2026-09-01T20:00:00.000Z",
  createdDate: "2026-08-20",
  currentPlan: plan(),
  ...over,
});

const input = (over: Partial<CloseInput> = {}): CloseInput => ({
  triggers: [],
  unplannedTodayCount: 0,
  ...over,
});

/**
 * BOSS-VISION §6, verbatim: "the three-strikes forced rewrite
 * (`skippedCount >= 3 && followedCount === 0` blocks re-confirming a plan that
 * has never worked). If the close makes that optional the feature is gone
 * though the screen remains."
 *
 * That last sentence is the whole test. A ceremony that SHOWS the failing plan
 * and lets you close anyway has a screen and no feature, and nothing about it
 * looks broken — the same silent shape as a second crown rendering perfectly.
 */
describe("evening close — the three-strikes forced rewrite blocks the close", () => {
  it("a plan skipped three times and never followed blocks completion", () => {
    const failing = trigger({
      currentPlan: plan({ skippedCount: 3, followedCount: 0, mustRewrite: true }),
    });
    expect(canCompleteClose(input({ triggers: [failing] }))).toBe(false);
  });

  it("names the trigger that blocks, so the surface can point at it", () => {
    const failing = trigger({
      id: "t-phone",
      name: "Phone during deep work",
      currentPlan: plan({ skippedCount: 4, followedCount: 0, mustRewrite: true }),
    });
    const blockers = closeBlockers(input({ triggers: [failing] }));
    expect(blockers).toEqual([
      { kind: "forced_rewrite", triggerId: "t-phone", triggerName: "Phone during deep work" },
    ]);
  });

  // "A plan that has ever been followed is never force-rewritten" —
  // plan-rules.ts. One success buys it out of the rule entirely.
  it("a plan followed even once never blocks, however often it was skipped", () => {
    const survived = trigger({
      currentPlan: plan({ skippedCount: 9, followedCount: 1, mustRewrite: false }),
    });
    expect(canCompleteClose(input({ triggers: [survived] }))).toBe(true);
  });

  it("a trigger with no plan at all does not block — nothing has failed yet", () => {
    expect(canCompleteClose(input({ triggers: [trigger({ currentPlan: null })] }))).toBe(true);
  });

  /**
   * ABSENT IS NOT ZERO, again. `mustRewrite` is computed upstream by
   * plan-rules.ts and arrives on the plan; this module must READ it rather than
   * recompute it from counts, so the two can never disagree. But an input that
   * omits it entirely is malformed data, not a passing plan — trusting a
   * missing flag as `false` would silently unblock every failing plan the day
   * someone changes the query's select list.
   */
  it("a plan missing its mustRewrite flag blocks rather than silently passing", () => {
    const malformed = trigger({
      currentPlan: { ...plan({ skippedCount: 5, followedCount: 0 }), mustRewrite: undefined as unknown as boolean },
    });
    expect(canCompleteClose(input({ triggers: [malformed] }))).toBe(false);
  });

  it("several failing plans are all reported, not just the first", () => {
    const a = trigger({ id: "a", name: "A", currentPlan: plan({ mustRewrite: true }) });
    const b = trigger({ id: "b", name: "B", currentPlan: plan({ mustRewrite: true }) });
    expect(closeBlockers(input({ triggers: [a, b] })).length).toBe(2);
  });

  it("an ordinary night with working plans closes cleanly", () => {
    const fine = trigger({ currentPlan: plan({ followedCount: 3, skippedCount: 1 }) });
    expect(closeBlockers(input({ triggers: [fine] }))).toEqual([]);
    expect(canCompleteClose(input({ triggers: [fine] }))).toBe(true);
  });
});

/**
 * Structure (a) of the ceremony: "give today's new distractions a plan". An
 * unplanned distraction captured today is an account item, but it is NOT the
 * same severity as a plan that has failed three times — one is work not yet
 * done, the other is a plan proven not to work. Reporting them as one kind
 * would let the surface treat them identically, and the forced rewrite is the
 * only one the vision says must be non-optional.
 */
describe("evening close — unplanned distractions are surfaced, not conflated", () => {
  it("today's unplanned distractions do not block the close", () => {
    expect(canCompleteClose(input({ unplannedTodayCount: 4 }))).toBe(true);
  });

  it("but they are reported so the account step can show them", () => {
    expect(closeBlockers(input({ unplannedTodayCount: 4 }))).toEqual([]);
  });
});
