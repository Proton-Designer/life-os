import { describe, expect, it } from "vitest";
import { buildAssessmentRiskInput } from "../build-assessment-risk-input";
import { computeAssignmentRisk } from "../assignment-risk";

const facts = {
  today: "2026-08-18",
  dueDate: "2026-08-25",
  weightPct: 20,
  difficultyRating: null,
  confidenceRating: null,
  targetGradePct: null,
} as const;

describe("buildAssessmentRiskInput", () => {
  it("falls back an unknown weight to 0 rather than inventing a share of the grade", () => {
    const input = buildAssessmentRiskInput({ ...facts, weightPct: null });
    expect(input.weightPct).toBe(0);
  });

  it("passes a known weight through unchanged", () => {
    const input = buildAssessmentRiskInput({ ...facts, weightPct: 40 });
    expect(input.weightPct).toBe(40);
  });

  it("has no calendar-busy source: committedHours is always 0, availableHours always positive", () => {
    const input = buildAssessmentRiskInput(facts);
    expect(input.committedHours).toBe(0);
    expect(input.availableHours).toBeGreaterThan(0);
  });

  it("has no per-assessment progress model: nothing planned is a real signal, not missing data", () => {
    const input = buildAssessmentRiskInput(facts);
    expect(input.plannedUnits).toBe(0);
    expect(input.completedUnits).toBe(0);
    // computeAssignmentRisk must read plannedUnits === 0 as unfinished = 1, not exclude it.
    const result = computeAssignmentRisk(input);
    expect(result.missingFactors).not.toContain("unfinished");
  });

  it("omits difficulty/confidence/target entirely when null, so the engine excludes rather than defaults them", () => {
    const input = buildAssessmentRiskInput(facts);
    expect(input).not.toHaveProperty("difficultyRating");
    expect(input).not.toHaveProperty("confidenceRating");
    expect(input).not.toHaveProperty("targetPct");
    expect(input).not.toHaveProperty("projectedPct");

    const result = computeAssignmentRisk(input);
    expect(result.missingFactors.sort()).toEqual(["difficulty", "gradeHeadroom", "knowledgeGap"].sort());
  });

  it("passes a real rating through so the engine actually uses it", () => {
    const input = buildAssessmentRiskInput({ ...facts, difficultyRating: 5, confidenceRating: 1 });
    expect(input.difficultyRating).toBe(5);
    expect(input.confidenceRating).toBe(1);
    const result = computeAssignmentRisk(input);
    expect(result.missingFactors).not.toContain("difficulty");
    expect(result.missingFactors).not.toContain("knowledgeGap");
  });

  it("leaves gradeHeadroom excluded when a target exists but no projection does — an aspiration is not a measurement", () => {
    const input = buildAssessmentRiskInput({ ...facts, targetGradePct: 90 });
    expect(input).not.toHaveProperty("projectedPct");
    const result = computeAssignmentRisk(input);
    expect(result.missingFactors).toContain("gradeHeadroom");
  });

  it("supplies a positive global start-delay prior so the engine never divides by / multiplies zero silently", () => {
    const input = buildAssessmentRiskInput(facts);
    expect(input.globalMeanStartDelayDays).toBeGreaterThan(0);
  });
});
