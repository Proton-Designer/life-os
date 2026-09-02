import { describe, expect, it } from "vitest";
import { computeAssignmentRisk, type AssignmentRiskInput } from "../assignment-risk";

// Mirrors CollegeOS packages/core/src/risk/assignmentRisk.test.ts — same fixtures, same
// assertions. This is the algorithm's contract test, not a School-specific one; it should
// only ever need to change if DOMAIN_ENGINE_SPEC.md §1 itself changes.

const base: AssignmentRiskInput = {
  today: "2026-08-18",
  dueDate: "2026-09-08", // 21 days out -> proximity floor
  weightPct: 0,
  difficultyRating: 1,
  confidenceRating: 5,
  completedUnits: 1,
  plannedUnits: 1,
  committedHours: 0,
  availableHours: 10,
  userMeanStartDelayDays: 0,
  userStartDelaySampleSize: 5,
  globalMeanStartDelayDays: 1,
  targetPct: 90,
  projectedPct: 90,
};

describe("computeAssignmentRisk", () => {
  it("returns 0 when every factor is at its floor", () => {
    const result = computeAssignmentRisk(base);
    expect(result.score).toBe(0);
    expect(result.band).toBe("low");
  });

  it("returns 100 when every factor is at its ceiling", () => {
    const result = computeAssignmentRisk({
      ...base,
      dueDate: base.today,
      weightPct: 30,
      difficultyRating: 5,
      confidenceRating: 1,
      completedUnits: 0,
      plannedUnits: 0,
      committedHours: 10,
      availableHours: 10,
      userMeanStartDelayDays: 2,
      userStartDelaySampleSize: 5,
      targetPct: 95,
      projectedPct: 90,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe("critical");
  });

  it("scores an overdue item at least as high as the identical item due today", () => {
    const dueToday = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: base.today });
    const overdue = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-10" });
    expect(overdue.score).toBeGreaterThanOrEqual(dueToday.score);
  });

  it("is monotonic in proximity: closer due dates never score lower", () => {
    const far = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-09-08" });
    const mid = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-28" });
    const near = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-20" });
    expect(mid.score).toBeGreaterThanOrEqual(far.score);
    expect(near.score).toBeGreaterThanOrEqual(mid.score);
  });

  it("is monotonic in weight: a higher grade share never scores lower", () => {
    const low = computeAssignmentRisk({ ...base, weightPct: 5, dueDate: "2026-08-25" });
    const high = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25" });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it("is monotonic in difficulty: a harder rating never scores lower", () => {
    const easy = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", difficultyRating: 1 });
    const hard = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", difficultyRating: 5 });
    expect(hard.score).toBeGreaterThanOrEqual(easy.score);
  });

  it("is monotonic in knowledge gap: lower self-rated understanding never scores lower", () => {
    const confident = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", confidenceRating: 5 });
    const lost = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", confidenceRating: 1 });
    expect(lost.score).toBeGreaterThanOrEqual(confident.score);
  });

  it("is monotonic in unfinished work: less progress never scores lower", () => {
    const done = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", completedUnits: 4, plannedUnits: 4 });
    const started = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", completedUnits: 1, plannedUnits: 4 });
    expect(started.score).toBeGreaterThanOrEqual(done.score);
  });

  it("is monotonic in congestion: more committed hours never scores lower", () => {
    const free = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", committedHours: 1, availableHours: 10 });
    const packed = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", committedHours: 9, availableHours: 10 });
    expect(packed.score).toBeGreaterThanOrEqual(free.score);
  });

  it("is monotonic in procrastination tendency: a larger start delay never scores lower", () => {
    const prompt = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", userMeanStartDelayDays: 0 });
    const delayed = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", userMeanStartDelayDays: 2 });
    expect(delayed.score).toBeGreaterThanOrEqual(prompt.score);
  });

  it("is monotonic in grade headroom: further below target never scores lower", () => {
    const onTarget = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", targetPct: 90, projectedPct: 90 });
    const behind = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", targetPct: 90, projectedPct: 80 });
    expect(behind.score).toBeGreaterThanOrEqual(onTarget.score);
  });

  it("keeps a 30%-weight exam 20 days out out of the critical band even under worst-case other factors", () => {
    const result = computeAssignmentRisk({
      today: "2026-08-18",
      dueDate: "2026-09-07",
      weightPct: 30,
      difficultyRating: 5,
      confidenceRating: 1,
      completedUnits: 0,
      plannedUnits: 0,
      committedHours: 10,
      availableHours: 10,
      userMeanStartDelayDays: 2,
      userStartDelaySampleSize: 5,
      globalMeanStartDelayDays: 1,
      targetPct: 95,
      projectedPct: 90,
    });
    expect(result.band).not.toBe("critical");
  });

  it("sums trace contributions to the score within rounding", () => {
    const result = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", committedHours: 5 });
    const summed = result.trace.reduce((acc, t) => acc + t.contribution, 0);
    expect(Math.abs(summed - result.score)).toBeLessThan(1);
  });

  it("excludes a missing difficulty rating and renormalizes remaining weights, rather than defaulting to 0 or 0.5", () => {
    const { difficultyRating, ...withoutDifficulty } = base;
    const withRating = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25" });
    const withoutRating = computeAssignmentRisk({ ...withoutDifficulty, weightPct: 20, dueDate: "2026-08-25" });
    expect(withoutRating.missingFactors).toEqual(["difficulty"]);
    const difficultyEntry = withoutRating.trace.find((t) => t.key === "difficulty");
    expect(difficultyEntry?.weight).toBe(0);
    expect(difficultyEntry?.contribution).toBe(0);
    const remainingWeightSum = withoutRating.trace.filter((t) => t.key !== "difficulty").reduce((s, t) => s + t.weight, 0);
    expect(remainingWeightSum).toBeCloseTo(1, 6);
    expect(withoutRating.score).toBeGreaterThanOrEqual(withRating.score - 5);
    expect(withoutRating.confidence).toBe("moderate");
  });

  it("excludes a missing self-rated confidence and renormalizes", () => {
    const { confidenceRating, ...withoutConfidence } = base;
    const result = computeAssignmentRisk({ ...withoutConfidence, weightPct: 20, dueDate: "2026-08-25" });
    expect(result.missingFactors).toEqual(["knowledgeGap"]);
    expect(result.confidence).toBe("moderate");
  });

  it("excludes a missing target/projected grade from gradeHeadroom instead of defaulting to 0", () => {
    const { targetPct, projectedPct, ...withoutTarget } = base;
    const result = computeAssignmentRisk({ ...withoutTarget, weightPct: 20, dueDate: "2026-08-25" });
    expect(result.missingFactors).toEqual(["gradeHeadroom"]);
    const entry = result.trace.find((t) => t.key === "gradeHeadroom");
    expect(entry?.weight).toBe(0);
    expect(result.confidence).toBe("moderate");
  });

  // R35 (2026-09-02): weight joins difficulty/knowledgeGap/gradeHeadroom as excludable —
  // an unweighted assessment is unmeasured, not confirmed worth 0% of the grade.
  it("excludes a missing weight and renormalizes, rather than scoring it as worth 0% of the grade", () => {
    const { weightPct, ...withoutWeight } = base;
    const withWeight = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25" });
    const withoutWeightResult = computeAssignmentRisk({ ...withoutWeight, dueDate: "2026-08-25" });
    expect(withoutWeightResult.missingFactors).toEqual(["weight"]);
    const weightEntry = withoutWeightResult.trace.find((t) => t.key === "weight");
    expect(weightEntry?.weight).toBe(0);
    expect(weightEntry?.contribution).toBe(0);
    const remainingWeightSum = withoutWeightResult.trace.filter((t) => t.key !== "weight").reduce((s, t) => s + t.weight, 0);
    expect(remainingWeightSum).toBeCloseTo(1, 6);
    // Missing data should not be a free discount: not scoring lower than a real 0% weight would.
    const zeroWeight = computeAssignmentRisk({ ...base, weightPct: 0, dueDate: "2026-08-25" });
    expect(withoutWeightResult.score).toBeGreaterThanOrEqual(zeroWeight.score);
    expect(withWeight.missingFactors).not.toContain("weight");
  });

  // The safety property that lets R35 land ahead of the weight-entry UI (Lead ruling,
  // 2026-09-02): today, every real `weight_pct` is null, so every assessment in a class
  // gains the SAME missing mass and is scaled by the SAME renormalization constant.
  // Scaling every row's `base` by one shared positive constant cannot reverse their
  // relative order — proven here directly (not assumed) for today's exact shape: an
  // unrated class (difficulty/confidence/target all absent too) with several assessments
  // that differ only by due date. Old behavior (weightPct: 0, a real zero) and new
  // behavior (weightPct omitted, excluded) may produce different absolute scores, but
  // must never disagree on ORDER — that's what a user actually sees.
  it("R35 safety: making weight excludable does not change relative ordering for today's all-unrated shape", () => {
    const commonUnrated = {
      today: "2026-08-20",
      completedUnits: 0,
      plannedUnits: 0,
      committedHours: 0,
      availableHours: 1,
      globalMeanStartDelayDays: 1.5,
    };
    const dueDates = ["2026-08-21", "2026-08-25", "2026-08-30", "2026-09-05", "2026-09-10", "2026-09-20"];
    const oldStyleScores = dueDates.map((dueDate) => computeAssignmentRisk({ ...commonUnrated, dueDate, weightPct: 0 }).score);
    const newStyleScores = dueDates.map((dueDate) => computeAssignmentRisk({ ...commonUnrated, dueDate }).score);

    const rankOrder = (scores: number[]) => scores.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
    expect(rankOrder(newStyleScores)).toEqual(rankOrder(oldStyleScores));
  });

  it("downgrades confidence further as more factors go missing", () => {
    const { difficultyRating, confidenceRating, targetPct, projectedPct, ...rest } = base;
    const result = computeAssignmentRisk({ ...rest, weightPct: 20, dueDate: "2026-08-25" });
    expect(result.missingFactors.sort()).toEqual(["difficulty", "gradeHeadroom", "knowledgeGap"].sort());
    expect(result.confidence).toBe("low");
  });

  it("falls back to the global mean start delay when the user has fewer than 5 observations", () => {
    const fewSamples = computeAssignmentRisk({
      ...base,
      weightPct: 20,
      dueDate: "2026-08-25",
      userMeanStartDelayDays: 0,
      userStartDelaySampleSize: 2,
      globalMeanStartDelayDays: 2,
    });
    const enoughSamples = computeAssignmentRisk({
      ...base,
      weightPct: 20,
      dueDate: "2026-08-25",
      userMeanStartDelayDays: 0,
      userStartDelaySampleSize: 5,
      globalMeanStartDelayDays: 2,
    });
    expect(fewSamples.score).toBeGreaterThan(enoughSamples.score);
  });

  it("rejects a negative available-hours-free congestion denominator without dividing by zero", () => {
    const result = computeAssignmentRisk({ ...base, weightPct: 20, dueDate: "2026-08-25", committedHours: 3, availableHours: 0 });
    expect(Number.isFinite(result.score)).toBe(true);
    const congestionEntry = result.trace.find((t) => t.key === "congestion");
    expect(congestionEntry?.normalized).toBe(1);
  });
});
