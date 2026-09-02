import { describe, expect, it } from "vitest";
import { computeCourseGrade } from "../courseGrade";
import type { GradeCategory, GradeItem } from "../types";

function item(partial: Partial<GradeItem> & Pick<GradeItem, "id" | "categoryId">): GradeItem {
  return { name: partial.id, pointsEarned: null, pointsPossible: 10, isExcused: false, ...partial };
}

describe("computeCourseGrade — empty course", () => {
  it("reports null current and projected grade with no categories or items", () => {
    const result = computeCourseGrade([], []);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedGrade).toBeNull();
  });
});

describe("computeCourseGrade — all-graded course", () => {
  it("sets currentGrade equal to projectedGrade when every category is resolved", () => {
    const categories: GradeCategory[] = [
      { id: "hw", name: "Homework", weightPct: 40, dropLowestN: 0, expectedItemCount: 1 },
      { id: "exam", name: "Exam", weightPct: 60, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const items: GradeItem[] = [
      item({ id: "hw1", categoryId: "hw", pointsEarned: 90, pointsPossible: 100 }),
      item({ id: "exam1", categoryId: "exam", pointsEarned: 80, pointsPossible: 100 }),
    ];
    const result = computeCourseGrade(categories, items);
    // 0.4*90 + 0.6*80 = 84
    expect(result.currentGrade).toBeCloseTo(84, 6);
    expect(result.projectedGrade).toBeCloseTo(84, 6);
  });
});

describe("computeCourseGrade — drop-lowest", () => {
  const category: GradeCategory = { id: "hw", name: "Homework", weightPct: 100, dropLowestN: 1, expectedItemCount: 5 };

  it("drops the lowest-percentage item by percentage, not raw points", () => {
    const items: GradeItem[] = [
      item({ id: "a", categoryId: "hw", pointsEarned: 8, pointsPossible: 10 }), // 80%
      item({ id: "b", categoryId: "hw", pointsEarned: 9, pointsPossible: 10 }), // 90%
      item({ id: "c", categoryId: "hw", pointsEarned: 6, pointsPossible: 10 }), // 60% -> dropped
      item({ id: "d", categoryId: "hw", pointsEarned: 10, pointsPossible: 10 }), // 100%
      item({ id: "e", categoryId: "hw", pointsEarned: 7, pointsPossible: 10 }), // 70%
    ];
    const result = computeCourseGrade([category], items);
    const cat = result.categoryResults[0]!;
    expect(cat.droppedItemIds).toEqual(["c"]);
    // survivors: 8+9+10+7 = 34 / 40 = 85%
    expect(cat.categoryPct).toBeCloseTo(85, 6);
    expect(cat.resolved).toBe(true);
    // complete: 5 graded items == expectedItemCount(5) -> not provisional
    expect(cat.provisional).toBe(false);
  });

  it("marks the category provisional while incomplete", () => {
    const items: GradeItem[] = [
      item({ id: "a", categoryId: "hw", pointsEarned: 18, pointsPossible: 20 }), // 90%
      item({ id: "b", categoryId: "hw", pointsEarned: 15, pointsPossible: 20 }), // 75%
      item({ id: "c", categoryId: "hw", pointsEarned: 20, pointsPossible: 20 }), // 100%
      item({ id: "d", categoryId: "hw", pointsEarned: 12, pointsPossible: 20 }), // 60% -> dropped
    ];
    const result = computeCourseGrade([{ ...category, expectedItemCount: 6 }], items);
    const cat = result.categoryResults[0]!;
    expect(cat.provisional).toBe(true);
    expect(cat.categoryPct).toBeCloseTo((53 / 60) * 100, 6);
  });

  it("handles fewer graded items than dropLowestN by leaving the category unresolved", () => {
    const items: GradeItem[] = [item({ id: "a", categoryId: "hw", pointsEarned: 9, pointsPossible: 10 })];
    const result = computeCourseGrade([{ ...category, dropLowestN: 2 }], items);
    const cat = result.categoryResults[0]!;
    expect(cat.droppedItemIds).toEqual(["a"]);
    expect(cat.categoryPct).toBeNull();
    expect(cat.resolved).toBe(false);
  });
});

describe("computeCourseGrade — excused items", () => {
  it("excludes excused items entirely from the category calculation", () => {
    const category: GradeCategory = { id: "hw", name: "Homework", weightPct: 100, dropLowestN: 0, expectedItemCount: 2 };
    const items: GradeItem[] = [
      item({ id: "a", categoryId: "hw", pointsEarned: 8, pointsPossible: 10 }),
      item({ id: "b", categoryId: "hw", pointsEarned: 2, pointsPossible: 10, isExcused: true }),
    ];
    const result = computeCourseGrade([category], items);
    const cat = result.categoryResults[0]!;
    expect(cat.categoryPct).toBeCloseTo(80, 6);
    expect(cat.gradedItemCount).toBe(1);
  });
});

describe("computeCourseGrade — extra credit above 100%", () => {
  it("allows earned > possible and flags it as an issue", () => {
    const category: GradeCategory = { id: "hw", name: "Homework", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 };
    const items: GradeItem[] = [item({ id: "a", categoryId: "hw", pointsEarned: 11, pointsPossible: 10 })];
    const result = computeCourseGrade([category], items);
    expect(result.categoryResults[0]!.categoryPct).toBeCloseTo(110, 6);
    expect(result.issues.some((i) => i.kind === "earnedExceedsPossible" && i.itemId === "a")).toBe(true);
  });
});

describe("computeCourseGrade — validation", () => {
  it("flags negative points but keeps them in the calculation", () => {
    const category: GradeCategory = { id: "hw", name: "Homework", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 };
    const items: GradeItem[] = [item({ id: "a", categoryId: "hw", pointsEarned: -2, pointsPossible: 10 })];
    const result = computeCourseGrade([category], items);
    expect(result.issues.some((i) => i.kind === "negativePoints" && i.itemId === "a")).toBe(true);
  });

  it("excludes items with pointsPossible <= 0 and flags them", () => {
    const category: GradeCategory = { id: "hw", name: "Homework", weightPct: 100, dropLowestN: 0, expectedItemCount: 2 };
    const items: GradeItem[] = [
      item({ id: "a", categoryId: "hw", pointsEarned: 5, pointsPossible: 0 }),
      item({ id: "b", categoryId: "hw", pointsEarned: 9, pointsPossible: 10 }),
    ];
    const result = computeCourseGrade([category], items);
    expect(result.issues.some((i) => i.kind === "invalidPointsPossible" && i.itemId === "a")).toBe(true);
    expect(result.categoryResults[0]!.categoryPct).toBeCloseTo(90, 6);
    expect(result.categoryResults[0]!.gradedItemCount).toBe(1);
  });

  it("flags weights summing to 95 without normalizing them", () => {
    const categories: GradeCategory[] = [
      { id: "a", name: "A", weightPct: 50, dropLowestN: 0, expectedItemCount: 1 },
      { id: "b", name: "B", weightPct: 45, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const result = computeCourseGrade(categories, []);
    expect(result.weightSum).toBe(95);
    expect(result.issues.some((i) => i.kind === "weightSumWarning" && i.message.includes("95"))).toBe(true);
  });

  it("flags weights summing to 105 without normalizing them", () => {
    const categories: GradeCategory[] = [
      { id: "a", name: "A", weightPct: 60, dropLowestN: 0, expectedItemCount: 1 },
      { id: "b", name: "B", weightPct: 45, dropLowestN: 0, expectedItemCount: 1 },
    ];
    const result = computeCourseGrade(categories, []);
    expect(result.weightSum).toBe(105);
    expect(result.issues.some((i) => i.kind === "weightSumWarning" && i.message.includes("105"))).toBe(true);
  });
});

describe("computeCourseGrade — a full realistic 4-category syllabus (hand-verified)", () => {
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

  it("resolves HW at 85%, complete and not provisional", () => {
    const result = computeCourseGrade(categories, items);
    const hw = result.categoryResults.find((c) => c.categoryId === "hw")!;
    expect(hw.categoryPct).toBeCloseTo(85, 6);
    expect(hw.provisional).toBe(false);
  });

  it("resolves Quizzes at 88.33%, provisional (incomplete)", () => {
    const result = computeCourseGrade(categories, items);
    const quiz = result.categoryResults.find((c) => c.categoryId === "quiz")!;
    expect(quiz.categoryPct).toBeCloseTo((53 / 60) * 100, 6);
    expect(quiz.provisional).toBe(true);
  });

  it("leaves Final unresolved with no earned weight, full remaining weight", () => {
    const result = computeCourseGrade(categories, items);
    const fin = result.categoryResults.find((c) => c.categoryId === "final")!;
    expect(fin.resolved).toBe(false);
    expect(fin.categoryPct).toBeNull();
  });

  it("computes currentGrade = 87.0833...% (hand-verified)", () => {
    const result = computeCourseGrade(categories, items);
    // (0.85*20 + 0.883333*15 + 0.88*25) / 60 * 100
    expect(result.currentGrade).toBeCloseTo(87.083333, 4);
  });

  it('with the default "current" assumption, projectedGrade equals currentGrade (weightSum=100)', () => {
    const result = computeCourseGrade(categories, items);
    expect(result.projectedGrade).toBeCloseTo(result.currentGrade!, 6);
  });

  it('with a "target" assumption of 90, projects 88.25%', () => {
    const result = computeCourseGrade(categories, items, { assumption: "target", targetPct: 90 });
    // 52.25 + 90*0.40 = 88.25
    expect(result.projectedGrade).toBeCloseTo(88.25, 4);
  });

  it("with an explicit numeric assumption of 95, projects 90.25%", () => {
    const result = computeCourseGrade(categories, items, { assumption: 95 });
    // 52.25 + 95*0.40 = 90.25
    expect(result.projectedGrade).toBeCloseTo(90.25, 4);
  });

  it('flags a missing targetPct when assumption is "target"', () => {
    const result = computeCourseGrade(categories, items, { assumption: "target" });
    expect(result.projectedGrade).toBeNull();
    expect(result.issues.some((i) => i.kind === "missingTargetAssumption")).toBe(true);
  });

  it("reports the correct weightSum with no warning", () => {
    const result = computeCourseGrade(categories, items);
    expect(result.weightSum).toBe(100);
    expect(result.issues.some((i) => i.kind === "weightSumWarning")).toBe(false);
  });
});
