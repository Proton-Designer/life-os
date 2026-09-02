import type { CourseGradeResult } from "./types";

export type RequiredScoreVerdict = "final" | "impossible" | "secured" | "onTrack";

export interface RequiredScoreResult {
  verdict: RequiredScoreVerdict;
  /** Uniform average percentage needed on the remaining weight. May be <0 or >100. */
  neededPct: number;
  earnedWeightPoints: number;
  remainingWeightPct: number;
  /** Present when verdict is 'impossible'. */
  maxAchievableGrade?: number;
  /** Present when verdict is 'secured'. */
  minRequiredToHold?: number;
  /** Present when verdict is 'final'. */
  finalGrade?: number;
  metTarget?: boolean;
  perRemainingCategory: Array<{ categoryId: string; requiredPct: number }>;
}

/**
 * Required-score solver. neededPct is dimensionally: (percentage points still needed) /
 * (remaining weight as a fraction of 100), i.e. `(target - earnedWeightPoints) /
 * remainingWeightPct * 100` — verified by hand against a full 4-category syllabus in
 * requiredScore.test.ts (94.375% needed on a 40%-weight final to reach 90 overall).
 */
export function solveRequiredScore(course: CourseGradeResult, target: number): RequiredScoreResult {
  const resolved = course.categoryResults.filter((c) => c.resolved);
  const remaining = course.categoryResults.filter((c) => !c.resolved);

  const earnedWeightPoints =
    resolved.reduce((s, c) => s + (c.categoryPct as number) * c.weightPct, 0) / 100;
  const remainingWeightPct = remaining.reduce((s, c) => s + c.weightPct, 0);

  if (remainingWeightPct === 0) {
    const finalGrade = earnedWeightPoints;
    return {
      verdict: "final",
      neededPct: 0,
      earnedWeightPoints,
      remainingWeightPct,
      finalGrade,
      metTarget: finalGrade >= target,
      perRemainingCategory: [],
    };
  }

  const neededPct = ((target - earnedWeightPoints) / remainingWeightPct) * 100;

  if (neededPct > 100) {
    return {
      verdict: "impossible",
      neededPct,
      earnedWeightPoints,
      remainingWeightPct,
      maxAchievableGrade: earnedWeightPoints + remainingWeightPct,
      perRemainingCategory: remaining.map((c) => ({ categoryId: c.categoryId, requiredPct: 100 })),
    };
  }

  if (neededPct <= 0) {
    const minRequiredToHold = Math.max(0, neededPct);
    return {
      verdict: "secured",
      neededPct,
      earnedWeightPoints,
      remainingWeightPct,
      minRequiredToHold,
      perRemainingCategory: remaining.map((c) => ({ categoryId: c.categoryId, requiredPct: minRequiredToHold })),
    };
  }

  return {
    verdict: "onTrack",
    neededPct,
    earnedWeightPoints,
    remainingWeightPct,
    perRemainingCategory: remaining.map((c) => ({ categoryId: c.categoryId, requiredPct: neededPct })),
  };
}
