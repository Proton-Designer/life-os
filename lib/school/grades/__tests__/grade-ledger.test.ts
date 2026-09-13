import { describe, expect, it } from "vitest";
import { computeClassGrade, type AssessmentGradeRow, type GradeCategoryDefinition } from "../grade-ledger";

function row(partial: Partial<AssessmentGradeRow> & Pick<AssessmentGradeRow, "id">): AssessmentGradeRow {
  return {
    weightPct: 25,
    pointsEarned: null,
    pointsPossible: null,
    isExcused: false,
    ...partial,
  };
}

describe("computeClassGrade — the empty-state majority case", () => {
  it("reports a null current grade, not a zero, when nothing has been graded yet", () => {
    const result = computeClassGrade([
      row({ id: "hw1", weightPct: 20, pointsEarned: null, pointsPossible: null }),
      row({ id: "final", weightPct: 80, pointsEarned: null, pointsPossible: null }),
    ]);
    expect(result.currentGrade).toBeNull();
    expect(result.projectedGrade).toBeNull();
  });
});

describe("computeClassGrade — a real, entered score", () => {
  it("computes a real current grade from real points, not a placeholder", () => {
    const result = computeClassGrade([
      row({ id: "hw1", weightPct: 20, pointsEarned: 45, pointsPossible: 50 }), // 90%
      row({ id: "final", weightPct: 80, pointsEarned: null, pointsPossible: null }),
    ]);
    expect(result.currentGrade).toBeCloseTo(90, 6);
    expect(result.categoryResults.find((c) => c.categoryId === "final")!.resolved).toBe(false);
  });
});

describe("computeClassGrade — null is never zero", () => {
  it("does not let an ungraded assessment drag the average toward zero", () => {
    const result = computeClassGrade([
      row({ id: "hw1", weightPct: 50, pointsEarned: 40, pointsPossible: 40 }), // 100%
      row({ id: "hw2", weightPct: 50, pointsEarned: null, pointsPossible: null }), // ungraded
    ]);
    // If ungraded were treated as 0, currentGrade would be 50. It must instead be
    // computed only from resolved weight (hw1), i.e. 100.
    expect(result.currentGrade).toBeCloseTo(100, 6);
  });
});

describe("computeClassGrade — excused is removed, not zeroed", () => {
  it("drops an excused assessment's weight from the calculation entirely", () => {
    const excused = computeClassGrade([
      row({ id: "hw1", weightPct: 50, pointsEarned: 40, pointsPossible: 40 }), // 100%
      row({ id: "midterm", weightPct: 50, isExcused: true, pointsEarned: 10, pointsPossible: 100 }), // would-be 10%
    ]);
    const notExcused = computeClassGrade([row({ id: "hw1", weightPct: 50, pointsEarned: 40, pointsPossible: 40 })]);
    // The excused midterm must not appear at all — not as a dragged-down score, not
    // as unresolved remaining weight either. currentGrade with it excused must equal
    // currentGrade with the row absent altogether.
    expect(excused.currentGrade).toBeCloseTo(notExcused.currentGrade!, 6);
    expect(excused.categoryResults.some((c) => c.categoryId === "midterm")).toBe(false);
  });
});

describe("computeClassGrade — extra credit stays representable", () => {
  it("allows pointsEarned above pointsPossible instead of clamping it", () => {
    const result = computeClassGrade([row({ id: "bonus", weightPct: 100, pointsEarned: 105, pointsPossible: 100 })]);
    expect(result.currentGrade).toBeCloseTo(105, 6);
  });
});

describe("computeClassGrade — an assessment with no weight assigned yet", () => {
  it("is excluded from the ledger rather than treated as zero-weight", () => {
    const withUnweighted = computeClassGrade([
      row({ id: "hw1", weightPct: 100, pointsEarned: 40, pointsPossible: 40 }),
      row({ id: "unweighted", weightPct: null, pointsEarned: 5, pointsPossible: 10 }),
    ]);
    const withoutIt = computeClassGrade([row({ id: "hw1", weightPct: 100, pointsEarned: 40, pointsPossible: 40 })]);
    expect(withUnweighted.currentGrade).toBeCloseTo(withoutIt.currentGrade!, 6);
    expect(withUnweighted.weightSum).toBe(withoutIt.weightSum);
  });
});

// Migration 152 (Phase 1 #11): real grade_categories, additive on top of the
// synthetic one-assessment-one-category shape every test above exercises.
// These prove the SECOND parameter is genuinely additive, not a rewrite:
// every test above passes zero categoryDefs and is completely unaffected by
// this section existing.
describe("computeClassGrade — real categories (migration 152)", () => {
  const homework: GradeCategoryDefinition = { id: "cat-hw", name: "Homework", weightPct: 40, dropLowestN: 1, expectedItemCount: 3 };
  const final: GradeCategoryDefinition = { id: "cat-final", name: "Final", weightPct: 60, dropLowestN: 0, expectedItemCount: 1 };

  it("groups assessments under their real category and applies its dropLowestN, not the assessment's own weight", () => {
    const result = computeClassGrade(
      [
        row({ id: "hw1", categoryId: "cat-hw", weightPct: null, pointsEarned: 40, pointsPossible: 50 }), // 80% — lowest, dropped
        row({ id: "hw2", categoryId: "cat-hw", weightPct: null, pointsEarned: 45, pointsPossible: 50 }), // 90%
        row({ id: "hw3", categoryId: "cat-hw", weightPct: null, pointsEarned: 50, pointsPossible: 50 }), // 100%
      ],
      [homework],
    );
    // Homework is the only resolved category once hw1 is dropped: (90+100)/(50+50) = 95%.
    const hwResult = result.categoryResults.find((c) => c.categoryId === "cat-hw")!;
    expect(hwResult.droppedItemIds).toEqual(["hw1"]);
    expect(hwResult.categoryPct).toBeCloseTo(95, 6);
    expect(result.currentGrade).toBeCloseTo(95, 6);
  });

  it("mixes real-category rows and uncategorized (synthetic) rows in the same class correctly", () => {
    const result = computeClassGrade(
      [
        row({ id: "hw1", categoryId: "cat-hw", weightPct: null, pointsEarned: 45, pointsPossible: 50 }),
        row({ id: "hw2", categoryId: "cat-hw", weightPct: null, pointsEarned: 45, pointsPossible: 50 }),
        // Not yet assigned to a category — keeps the original synthetic treatment,
        // scored on its OWN weightPct (10), alongside the 40/60 category split above.
        row({ id: "pop-quiz", categoryId: null, weightPct: 10, pointsEarned: 10, pointsPossible: 10 }), // 100%
      ],
      [homework, final],
    );
    expect(result.weightSum).toBeCloseTo(40 + 60 + 10, 6);
    expect(result.categoryResults.some((c) => c.categoryId === "pop-quiz")).toBe(true);
    expect(result.categoryResults.some((c) => c.categoryId === "cat-hw")).toBe(true);
  });

  it("counts a declared-but-empty category as real remaining weight, never zero and never absent", () => {
    // dropLowestN: 0 here, deliberately different from the shared `homework`
    // fixture above (dropLowestN: 1) -- with only one graded item and a
    // drop of 1, that category would itself resolve to null (correctly --
    // dropping your only item leaves nothing), which would confound this
    // test's actual subject: "Final," which has NO assessments at all yet.
    const gradedCategory: GradeCategoryDefinition = { id: "cat-hw", name: "Homework", weightPct: 40, dropLowestN: 0, expectedItemCount: 3 };
    const result = computeClassGrade(
      [row({ id: "hw1", categoryId: "cat-hw", weightPct: null, pointsEarned: 45, pointsPossible: 50 })], // 90%
      [gradedCategory, final], // "Final" has no assessments filed under it yet
    );
    const finalResult = result.categoryResults.find((c) => c.categoryId === "cat-final")!;
    expect(finalResult.resolved).toBe(false);
    expect(finalResult.categoryPct).toBeNull();
    expect(result.weightSum).toBeCloseTo(100, 6); // both categories' weight counted, not just Homework's
    // currentGrade must come only from the resolved 40% (Homework @ 90%), never
    // treat Final's unearned 60% as a zero.
    expect(result.currentGrade).toBeCloseTo(90, 6);
  });

  it("a category reference to an id NOT in categoryDefs falls back to the synthetic shape (never silently drops the row)", () => {
    const result = computeClassGrade(
      [row({ id: "hw1", categoryId: "cat-unknown", weightPct: 100, pointsEarned: 45, pointsPossible: 50 })],
      [], // categoryDefs doesn't know "cat-unknown" — same as omitting categoryDefs entirely
    );
    expect(result.categoryResults.some((c) => c.categoryId === "hw1")).toBe(true);
    expect(result.currentGrade).toBeCloseTo(90, 6);
  });
});
