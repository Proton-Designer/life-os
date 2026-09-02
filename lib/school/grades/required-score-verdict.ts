import { solveRequiredScore } from "./requiredScore";
import type { CourseGradeResult } from "./types";

/**
 * The required-score verdict, as one line of display text, or `null` when
 * there is nothing to say a number about. Two distinct reasons collapse to
 * the same `null`, deliberately: no target set (the user hasn't decided
 * what they're solving for), and nothing in the ledger carries weight yet
 * (there's no course to solve against). Both are "no verdict," never a
 * fabricated 0% or 100%-remaining placeholder — the caller renders a prompt
 * instead of a number in either case.
 */
export function requiredScoreVerdictText(course: CourseGradeResult, targetGradePct: number | null): string | null {
  if (targetGradePct == null) return null;
  if (course.categoryResults.length === 0) return null;

  const solved = solveRequiredScore(course, targetGradePct);

  switch (solved.verdict) {
    case "onTrack":
      return `Need ${solved.neededPct.toFixed(1)}% on the rest to reach ${targetGradePct}%.`;
    case "impossible":
      return `Not reachable even with 100% on the rest — the max possible is ${solved.maxAchievableGrade!.toFixed(1)}%.`;
    case "secured":
      return `Already secured — ${targetGradePct}% is locked in no matter what's left.`;
    case "final":
      return solved.metTarget
        ? `Target met — final grade ${solved.finalGrade!.toFixed(1)}%.`
        : `Target missed — final grade ${solved.finalGrade!.toFixed(1)}%.`;
  }
}
