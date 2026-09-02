import { describe, expect, it } from "vitest";
import { computeScenario } from "../scenario";
import { solveRequiredScore } from "../requiredScore";
import type { GradeCategory, GradeItem } from "../types";

function item(partial: Partial<GradeItem> & Pick<GradeItem, "id" | "categoryId">): GradeItem {
  return { name: partial.id, pointsEarned: null, pointsPossible: 10, isExcused: false, ...partial };
}

// Two remaining categories: Exam 3 (weight 30) and Final (weight 30). 40% already resolved at 90%.
const categories: GradeCategory[] = [
  { id: "resolved", name: "Resolved so far", weightPct: 40, dropLowestN: 0, expectedItemCount: 1 },
  { id: "exam3", name: "Exam 3", weightPct: 30, dropLowestN: 0, expectedItemCount: 1 },
  { id: "final", name: "Final", weightPct: 30, dropLowestN: 0, expectedItemCount: 1 },
];
const items: GradeItem[] = [
  item({ id: "r1", categoryId: "resolved", pointsEarned: 90, pointsPossible: 100 }),
  item({ id: "e3", categoryId: "exam3", pointsEarned: null, pointsPossible: 100 }),
  item({ id: "f1", categoryId: "final", pointsEarned: null, pointsPossible: 100 }),
];

describe("computeScenario", () => {
  it("treats a hypothetical as resolved and re-solves the rest", () => {
    // earnedWeightPoints so far = 0.4*90 = 36. If Exam 3 = 85 (resolved), remaining is just Final(30).
    // new earnedWeightPoints = 36 + 0.30*85 = 61.5. Needed on Final for a 90: (90-61.5)/30*100 = 95.0
    const scenario = computeScenario(categories, items, [{ categoryId: "exam3", assumedPct: 85 }]);
    const solved = solveRequiredScore(scenario, 90);
    expect(solved.verdict).toBe("onTrack");
    expect(solved.neededPct).toBeCloseTo(95, 4);
    expect(solved.perRemainingCategory).toEqual([{ categoryId: "final", requiredPct: 95 }]);
  });

  it("marks the hypothetical category resolved and not provisional", () => {
    const scenario = computeScenario(categories, items, [{ categoryId: "exam3", assumedPct: 85 }]);
    const exam3 = scenario.categoryResults.find((c) => c.categoryId === "exam3")!;
    expect(exam3.resolved).toBe(true);
    expect(exam3.categoryPct).toBe(85);
    expect(exam3.provisional).toBe(false);
  });

  it("applying multiple hypotheticals resolves the whole course to a final grade", () => {
    const scenario = computeScenario(categories, items, [
      { categoryId: "exam3", assumedPct: 85 },
      { categoryId: "final", assumedPct: 96 },
    ]);
    const solved = solveRequiredScore(scenario, 90);
    expect(solved.verdict).toBe("final");
    // 0.4*90 + 0.3*85 + 0.3*96 = 36 + 25.5 + 28.8 = 90.3
    expect(solved.finalGrade).toBeCloseTo(90.3, 4);
    expect(solved.metTarget).toBe(true);
  });
});
