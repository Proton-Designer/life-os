import { describe, expect, it } from "vitest";
import { toAssessmentGradeRows, type AssessmentGradeSource } from "../build-grade-rows";
import { computeClassGrade } from "../grade-ledger";

const row = (over: Partial<AssessmentGradeSource> = {}): AssessmentGradeSource => ({
  id: "a1",
  weight_pct: 20,
  points_earned: 45,
  points_possible: 50,
  is_excused: false,
  ...over,
});

// ---------------------------------------------------------------------------
// THIS BOUNDARY IS WHERE null-is-never-zero ACTUALLY GETS TESTED.
//
// The engine is already right -- Eng 2 proved an ungraded item doesn't drag a
// grade down and an excused one is removed rather than zeroed. Every one of those
// proofs is downstream of this mapping. A single `?? 0` added here for convenience
// converts "not graded yet" into a hard zero BEFORE the engine ever sees it, and
// every engine test still passes, because the engine is being handed a lie.
//
// So these assertions are about what the adapter must NOT do.
// ---------------------------------------------------------------------------
describe("toAssessmentGradeRows — nulls survive the mapping", () => {
  it("a null points_earned arrives as null, never as 0", () => {
    const [mapped] = toAssessmentGradeRows([row({ points_earned: null, points_possible: null })]);
    expect(mapped.pointsEarned).toBeNull();
    expect(mapped.pointsPossible).toBeNull();
    // The distinction the whole rule protects: `?? 0` would satisfy "is a number".
    expect(mapped.pointsEarned).not.toBe(0);
  });

  it("a null weight_pct arrives as null — a weightless assessment is not a 0%-weight one", () => {
    const [mapped] = toAssessmentGradeRows([row({ weight_pct: null })]);
    expect(mapped.weightPct).toBeNull();
    expect(mapped.weightPct).not.toBe(0);
  });

  it("end to end: an ungraded row does not drag the grade down after mapping", () => {
    // 40/40 at 50% + an ungraded 50% item. Current grade must be 100, not 50.
    const rows = toAssessmentGradeRows([
      row({ id: "done", weight_pct: 50, points_earned: 40, points_possible: 40 }),
      row({ id: "ungraded", weight_pct: 50, points_earned: null, points_possible: null }),
    ]);
    expect(computeClassGrade(rows).currentGrade).toBeCloseTo(100);
  });

  it("end to end: an excused row is removed from the calculation, not scored zero", () => {
    const withExcused = toAssessmentGradeRows([
      row({ id: "done", weight_pct: 50, points_earned: 40, points_possible: 40 }),
      row({ id: "excused", weight_pct: 50, points_earned: null, points_possible: 100, is_excused: true }),
    ]);
    const withoutRow = toAssessmentGradeRows([
      row({ id: "done", weight_pct: 50, points_earned: 40, points_possible: 40 }),
    ]);
    expect(computeClassGrade(withExcused).currentGrade).toBeCloseTo(
      computeClassGrade(withoutRow).currentGrade!,
      6,
    );
  });

  it("extra credit survives the mapping unclamped", () => {
    const [mapped] = toAssessmentGradeRows([row({ points_earned: 105, points_possible: 100 })]);
    expect(mapped.pointsEarned).toBe(105);
    expect(computeClassGrade([mapped]).currentGrade).toBeCloseTo(105);
  });

  it("is_excused is carried through, not inferred from a null score", () => {
    // An ungraded row and an excused row both have no earned points. They are
    // different facts and must not collapse into one.
    const [ungraded] = toAssessmentGradeRows([row({ points_earned: null, points_possible: null })]);
    const [excused] = toAssessmentGradeRows([row({ points_earned: null, points_possible: 50, is_excused: true })]);
    expect(ungraded.isExcused).toBe(false);
    expect(excused.isExcused).toBe(true);
  });
});
