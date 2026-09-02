import { describe, expect, it } from "vitest";
import { computeCourseGrade } from "../courseGrade";
import { projectClassGrade } from "../grade-projection";
import type { GradeCategory, GradeItem } from "../types";

function item(partial: Partial<GradeItem> & Pick<GradeItem, "id" | "categoryId">): GradeItem {
  return { name: partial.id, pointsEarned: null, pointsPossible: 100, isExcused: false, ...partial };
}

describe("projectClassGrade — R59 fixture A: one graded assessment, nothing else assigned", () => {
  // 25-weight midterm at 78%, no other category exists at all (weightSum=25).
  const categories: GradeCategory[] = [{ id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 }];
  const items: GradeItem[] = [item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 })];
  const course = computeCourseGrade(categories, items);

  it("current stays 78.0% (unchanged — already correct)", () => {
    expect(projectClassGrade(course).currentGrade).toBeCloseTo(78, 6);
  });

  it("projected is 78.0%, not 19.5% — never divides the graded points by a literal 100", () => {
    // The bug this fixture exists to kill: (78*25)/100 = 19.5 would be the old,
    // wrong answer, treating the unassigned 75 as existing-and-scoring-zero.
    const projected = projectClassGrade(course).projectedGrade!;
    expect(projected).toBeCloseTo(78, 6);
    expect(projected).not.toBeCloseTo(19.5, 1);
  });

  it("reports 75% of the grade as not yet weighted", () => {
    expect(projectClassGrade(course).unweightedPct).toBeCloseTo(75, 6);
  });
});

describe("projectClassGrade — R59 fixture B: genuinely unreachable (control — verdict logic isn't broken)", () => {
  // 60-weight midterm at 78%, no other category (weightSum=60).
  const categories: GradeCategory[] = [{ id: "mid", name: "Midterm", weightPct: 60, dropLowestN: 0, expectedItemCount: 1 }];
  const items: GradeItem[] = [item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 })];
  const course = computeCourseGrade(categories, items);

  it("current 78.0%, projected 78.0%, 40% not yet weighted", () => {
    const p = projectClassGrade(course);
    expect(p.currentGrade).toBeCloseTo(78, 6);
    expect(p.projectedGrade).toBeCloseTo(78, 6);
    expect(p.unweightedPct).toBeCloseTo(40, 6);
  });
});

describe("projectClassGrade — R59 fixture C: fully specified syllabus (weightSum=100), still works", () => {
  // 25-weight midterm at 78% + a real 75-weight final that exists but isn't graded yet.
  const categories: GradeCategory[] = [
    { id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 },
    { id: "final", name: "Final", weightPct: 75, dropLowestN: 0, expectedItemCount: 1 },
  ];
  const items: GradeItem[] = [
    item({ id: "m1", categoryId: "mid", pointsEarned: 78, pointsPossible: 100 }),
    item({ id: "f1", categoryId: "final", pointsEarned: null, pointsPossible: 100 }),
  ];
  const course = computeCourseGrade(categories, items);

  it("same current/projected as fixture A, but no unweighted line (weightSum is 100)", () => {
    const p = projectClassGrade(course);
    expect(p.currentGrade).toBeCloseTo(78, 6);
    expect(p.projectedGrade).toBeCloseTo(78, 6);
    expect(p.unweightedPct).toBeNull();
  });
});

describe("projectClassGrade — nothing graded at all", () => {
  it("projected is absent (null), not a fabricated number, when graded weight is zero", () => {
    const categories: GradeCategory[] = [{ id: "mid", name: "Midterm", weightPct: 25, dropLowestN: 0, expectedItemCount: 1 }];
    const items: GradeItem[] = [item({ id: "m1", categoryId: "mid", pointsEarned: null, pointsPossible: 100 })];
    const course = computeCourseGrade(categories, items);
    const p = projectClassGrade(course);
    expect(p.currentGrade).toBeNull();
    expect(p.projectedGrade).toBeNull();
  });
});

describe("projectClassGrade — fully graded (remaining weight is zero)", () => {
  it("projected equals current, not a null and not a divided-differently number", () => {
    const categories: GradeCategory[] = [{ id: "only", name: "Only", weightPct: 100, dropLowestN: 0, expectedItemCount: 1 }];
    const items: GradeItem[] = [item({ id: "a", categoryId: "only", pointsEarned: 93, pointsPossible: 100 })];
    const course = computeCourseGrade(categories, items);
    const p = projectClassGrade(course);
    expect(p.currentGrade).toBeCloseTo(93, 6);
    expect(p.projectedGrade).toBeCloseTo(93, 6);
    expect(p.unweightedPct).toBeNull();
  });
});
