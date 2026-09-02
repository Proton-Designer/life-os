import { describe, expect, it } from "vitest";
import { computeCourseGrade } from "../courseGrade";
import { requiredScoreVerdictText } from "../required-score-verdict";
import type { GradeCategory, GradeItem } from "../types";

function item(partial: Partial<GradeItem> & Pick<GradeItem, "id" | "categoryId">): GradeItem {
  return { name: partial.id, pointsEarned: null, pointsPossible: 100, isExcused: false, ...partial };
}

describe("requiredScoreVerdictText — no target set", () => {
  it("renders no number at all — null, not a fabricated verdict", () => {
    const categories: GradeCategory[] = [{ id: "hw", name: "HW", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 }];
    const items: GradeItem[] = [item({ id: "a", categoryId: "hw", pointsEarned: 90, pointsPossible: 100 })];
    const course = computeCourseGrade(categories, items);
    expect(requiredScoreVerdictText(course, null)).toBeNull();
  });
});

describe("requiredScoreVerdictText — onTrack (the assigned red)", () => {
  it("target 90, current 80.7% resolved at 30% weight, 70% remaining: states the exact required percentage", () => {
    const categories: GradeCategory[] = [
      { id: "resolved", name: "Resolved so far", weightPct: 30, dropLowestN: 0, expectedItemCount: 1 },
      { id: "rest", name: "The rest", weightPct: 70, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "r1", categoryId: "resolved", pointsEarned: 80.7, pointsPossible: 100 }),
      item({ id: "f1", categoryId: "rest", pointsEarned: null, pointsPossible: 100 }),
    ];
    const course = computeCourseGrade(categories, items);
    // earnedWeightPoints = 0.30*80.7 = 24.21; neededPct = (90-24.21)/70*100 = 93.985714...
    const text = requiredScoreVerdictText(course, 90);
    expect(text).toBe("Need 94.0% on the rest to reach 90%.");
  });
});

describe("requiredScoreVerdictText — impossible target", () => {
  it("says plainly that the target isn't reachable, and gives the real ceiling", () => {
    const categories: GradeCategory[] = [
      { id: "resolved", name: "Resolved so far", weightPct: 80, dropLowestN: 0, expectedItemCount: 1 },
      { id: "rest", name: "The rest", weightPct: 20, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "r1", categoryId: "resolved", pointsEarned: 60, pointsPossible: 100 }),
      item({ id: "f1", categoryId: "rest", pointsEarned: null, pointsPossible: 100 }),
    ];
    const course = computeCourseGrade(categories, items);
    // earnedWeightPoints = 0.8*60 = 48; maxAchievable = 48 + 20 = 68
    const text = requiredScoreVerdictText(course, 90);
    expect(text).toBe("Not reachable even with 100% on the rest — the max possible is 68.0%.");
  });
});

describe("requiredScoreVerdictText — already secured", () => {
  it("says the target is locked in, not a required percentage", () => {
    const categories: GradeCategory[] = [
      { id: "resolved", name: "Resolved so far", weightPct: 80, dropLowestN: 0, expectedItemCount: 1 },
      { id: "rest", name: "The rest", weightPct: 20, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "r1", categoryId: "resolved", pointsEarned: 98, pointsPossible: 100 }),
      item({ id: "f1", categoryId: "rest", pointsEarned: null, pointsPossible: 100 }),
    ];
    const course = computeCourseGrade(categories, items);
    const text = requiredScoreVerdictText(course, 70);
    expect(text).toBe("Already secured — 70% is locked in no matter what's left.");
  });
});

describe("requiredScoreVerdictText — final grade, nothing remaining", () => {
  it("reports whether the finished target was met, not a required percentage", () => {
    const categories: GradeCategory[] = [{ id: "only", name: "Only", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 }];
    const met: GradeItem[] = [item({ id: "a", categoryId: "only", pointsEarned: 93, pointsPossible: 100 })];
    const missed: GradeItem[] = [item({ id: "a", categoryId: "only", pointsEarned: 60, pointsPossible: 100 })];

    expect(requiredScoreVerdictText(computeCourseGrade(categories, met), 90)).toBe("Target met — final grade 93.0%.");
    expect(requiredScoreVerdictText(computeCourseGrade(categories, missed), 90)).toBe("Target missed — final grade 60.0%.");
  });
});

describe("requiredScoreVerdictText — nothing weighted yet", () => {
  it("renders no number when there is nothing in the ledger to solve against", () => {
    const course = computeCourseGrade([], []);
    expect(requiredScoreVerdictText(course, 90)).toBeNull();
  });
});
