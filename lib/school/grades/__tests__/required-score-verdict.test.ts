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

describe("requiredScoreVerdictText — R59 fixture A: unassigned weight, onTrack", () => {
  it("target 90, 25-weight midterm at 78%, nothing else assigned: solves over the full remaining 75%", () => {
    const categories: GradeCategory[] = [{ id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 }];
    const items: GradeItem[] = [item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 })];
    const course = computeCourseGrade(categories, items);
    // earnedRaw = 0.25*78 = 19.5; remainingWeight = 100-25 = 75; neededPct = (90-19.5)/75*100 = 94.0
    expect(requiredScoreVerdictText(course, 90)).toBe("Need 94.0% across the remaining 75%.");
  });
});

describe("requiredScoreVerdictText — R59 fixture B: genuinely unreachable (control)", () => {
  it("target 90, 60-weight midterm at 78%, nothing else assigned: still Target missed, correctly", () => {
    const categories: GradeCategory[] = [{ id: "mid", name: "Midterm", weightPct: 60, dropLowestN: 0, expectedItemCount: 1 }];
    const items: GradeItem[] = [item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 })];
    const course = computeCourseGrade(categories, items);
    // earnedRaw = 0.60*78 = 46.8; remainingWeight = 40; max = 46.8+40 = 86.8 < 90
    expect(requiredScoreVerdictText(course, 90)).toBe(
      "Target missed — even 100% on the remaining 40% caps you at 86.8%."
    );
  });
});

describe("requiredScoreVerdictText — R59 fixture C: fully specified, same number as fixture A", () => {
  it("25-weight midterm at 78% + a real 75-weight ungraded final: identical verdict text to fixture A", () => {
    const categories: GradeCategory[] = [
      { id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 },
      { id: "final", name: "Final", weightPct: 75, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 }),
      item({ id: "f1", categoryId: "final", pointsEarned: null, pointsPossible: 100 }),
    ];
    const course = computeCourseGrade(categories, items);
    expect(requiredScoreVerdictText(course, 90)).toBe("Need 94.0% across the remaining 75%.");
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

describe("requiredScoreVerdictText — nothing graded yet, but a target is set", () => {
  it("still solves — needed percentage equals the target itself when zero weight is graded", () => {
    const categories: GradeCategory[] = [
      { id: "a", name: "A", weightPct: 50, dropLowestN: 0, expectedItemCount: 1 },
      { id: "b", name: "B", weightPct: 50, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "a1", categoryId: "a", pointsEarned: null, pointsPossible: 100 }),
      item({ id: "b1", categoryId: "b", pointsEarned: null, pointsPossible: 100 }),
    ];
    const course = computeCourseGrade(categories, items);
    expect(requiredScoreVerdictText(course, 90)).toBe("Need 90.0% across the remaining 100%.");
  });
});
