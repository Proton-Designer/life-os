import { describe, expect, it } from "vitest";
import { computeClassGrade, type AssessmentGradeRow } from "../grade-ledger";

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
