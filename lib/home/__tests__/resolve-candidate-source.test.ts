import { describe, expect, it } from "vitest";
import { resolveCandidateSource, SELF_MASTERY_CANDIDATE_ID } from "../resolve-candidate-source";
import { buildCandidatesFromPriorityItems, buildSelfMasteryCandidate } from "../build-candidates";
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

describe("resolveCandidateSource (Boss requirement: exhaustive by construction)", () => {
  it("every candidate id build-candidates.ts's builders can actually produce resolves back to exactly one source", () => {
    const items = [
      priorityItem({ id: "prayer-fajr", domain: "deen" }),
      priorityItem({ id: "kill-list", domain: "business" }),
      priorityItem({ id: "task-1", domain: "school" }),
      priorityItem({ id: "task-2", domain: "co_op" }),
      priorityItem({ id: "fitness-today", domain: "fitness" }),
    ];
    const priorityCandidates = buildCandidatesFromPriorityItems(items, {});
    const selfMastery = buildSelfMasteryCandidate({ hasCandidate: true, dueAt: null, decay: null, cost: null }, {});
    const allCandidates = [...priorityCandidates, selfMastery!];

    expect(allCandidates.length).toBeGreaterThan(0); // sanity: this is actually exercising real candidates
    for (const candidate of allCandidates) {
      const source = resolveCandidateSource(candidate.id, items);
      expect(source, `candidate id "${candidate.id}" (area ${candidate.area}) resolved to no source`).not.toBeNull();
    }
  });

  it("resolves a PriorityItem-sourced candidate id to the exact original item", () => {
    const items = [priorityItem({ id: "task-1", domain: "school", title: "Essay due" })];

    const source = resolveCandidateSource("task-1", items);

    expect(source).toEqual({ kind: "priority_item", item: items[0] });
  });

  it("resolves the Self-Mastery sentinel id regardless of what's in items", () => {
    const source = resolveCandidateSource(SELF_MASTERY_CANDIDATE_ID, []);
    expect(source).toEqual({ kind: "self_mastery" });
  });

  it("an id matching nothing (a genuinely new, unhandled candidate shape) resolves to null -- the caller must treat this as 'nothing to act on,' never silently ignore it", () => {
    const source = resolveCandidateSource("some-future-candidate-id", []);
    expect(source).toBeNull();
  });
});
