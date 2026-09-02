import { describe, expect, it } from "vitest";
import { computeCourseGrade } from "../courseGrade";
import { solveRequiredScore } from "../requiredScore";
import type { GradeCategory, GradeItem } from "../types";

function item(partial: Partial<GradeItem> & Pick<GradeItem, "id" | "categoryId">): GradeItem {
  return { name: partial.id, pointsEarned: null, pointsPossible: 10, isExcused: false, ...partial };
}

// Same hand-verified syllabus as courseGrade.test.ts: earnedWeightPoints = 52.25, remainingWeight = 40.
const categories: GradeCategory[] = [
  { id: "hw", name: "Homework", weightPct: 20, dropLowestN: 1, expectedItemCount: 5 },
  { id: "quiz", name: "Quizzes", weightPct: 15, dropLowestN: 1, expectedItemCount: 6 },
  { id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 },
  { id: "final", name: "Final", weightPct: 40, dropLowestN: 0, expectedItemCount: 1 },
];
const items: GradeItem[] = [
  item({ id: "hw1", categoryId: "hw", pointsEarned: 8, pointsPossible: 10 }),
  item({ id: "hw2", categoryId: "hw", pointsEarned: 9, pointsPossible: 10 }),
  item({ id: "hw3", categoryId: "hw", pointsEarned: 6, pointsPossible: 10 }),
  item({ id: "hw4", categoryId: "hw", pointsEarned: 10, pointsPossible: 10 }),
  item({ id: "hw5", categoryId: "hw", pointsEarned: 7, pointsPossible: 10 }),
  item({ id: "q1", categoryId: "quiz", pointsEarned: 18, pointsPossible: 20 }),
  item({ id: "q2", categoryId: "quiz", pointsEarned: 15, pointsPossible: 20 }),
  item({ id: "q3", categoryId: "quiz", pointsEarned: 20, pointsPossible: 20 }),
  item({ id: "q4", categoryId: "quiz", pointsEarned: 12, pointsPossible: 20 }),
  item({ id: "m1", categoryId: "mid", pointsEarned: 88, pointsPossible: 100 }),
  item({ id: "f1", categoryId: "final", pointsEarned: null, pointsPossible: 100 }),
];

describe("solveRequiredScore — onTrack (hand-verified)", () => {
  it("requires 94.375% on the Final to reach a 90 overall", () => {
    const course = computeCourseGrade(categories, items);
    const solved = solveRequiredScore(course, 90);
    expect(solved.verdict).toBe("onTrack");
    // (90 - 52.25) / 40 * 100 = 94.375
    expect(solved.neededPct).toBeCloseTo(94.375, 4);
    expect(solved.perRemainingCategory).toEqual([{ categoryId: "final", requiredPct: solved.neededPct }]);
  });
});

describe("solveRequiredScore — impossible target", () => {
  it("reports impossible with the max achievable grade", () => {
    const course = computeCourseGrade(categories, items);
    const solved = solveRequiredScore(course, 99);
    expect(solved.verdict).toBe("impossible");
    expect(solved.neededPct).toBeGreaterThan(100);
    // 52.25 + 40 = 92.25
    expect(solved.maxAchievableGrade).toBeCloseTo(92.25, 4);
  });
});

describe("solveRequiredScore — already-secured target", () => {
  it("reports secured with a minimum-to-hold of 0", () => {
    const course = computeCourseGrade(categories, items);
    const solved = solveRequiredScore(course, 50);
    expect(solved.verdict).toBe("secured");
    expect(solved.minRequiredToHold).toBe(0);
  });
});

describe("solveRequiredScore — zero remaining weight", () => {
  const finalCategory: GradeCategory = { id: "only", name: "Only", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 };
  const finalItems: GradeItem[] = [item({ id: "a", categoryId: "only", pointsEarned: 93, pointsPossible: 100 })];

  it("reports final with metTarget=true when the finished grade meets the target", () => {
    const course = computeCourseGrade([finalCategory], finalItems);
    const solved = solveRequiredScore(course, 90);
    expect(solved.verdict).toBe("final");
    expect(solved.finalGrade).toBeCloseTo(93, 6);
    expect(solved.metTarget).toBe(true);
    expect(solved.perRemainingCategory).toEqual([]);
  });

  it("reports final with metTarget=false when the finished grade missed the target", () => {
    const course = computeCourseGrade([finalCategory], finalItems);
    const solved = solveRequiredScore(course, 95);
    expect(solved.verdict).toBe("final");
    expect(solved.metTarget).toBe(false);
  });
});
