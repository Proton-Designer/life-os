import type { CourseGradeResult } from "./types";

/**
 * The required-score verdict, as one line of display text, or `null` when
 * there is nothing to say a number about — no target set, or nothing in the
 * ledger carries weight at all. The caller renders a prompt instead of a
 * number in either case.
 *
 * R59: solves over ALL weight not yet graded (`100 - gradedWeight`), not
 * just weight that has been itemised into an assessment. Unassigned weight
 * is still weight the student will eventually earn against — it just isn't
 * itemised yet — so "final"/"impossible" must not trigger just because no
 * *category* remains, only because no *weight* remains. This intentionally
 * does not go through the ported `solveRequiredScore`, whose remaining-weight
 * definition (assigned-but-ungraded categories only) is exactly the
 * distinction R59 exists to remove for this surface.
 */
export function requiredScoreVerdictText(course: CourseGradeResult, targetGradePct: number | null): string | null {
  if (targetGradePct == null) return null;
  if (course.categoryResults.length === 0) return null;

  const resolved = course.categoryResults.filter((c) => c.resolved);
  const gradedWeight = resolved.reduce((s, c) => s + c.weightPct, 0);
  const earnedRaw = resolved.reduce((s, c) => s + (c.categoryPct as number) * c.weightPct, 0) / 100;
  const remainingWeight = 100 - gradedWeight;

  if (remainingWeight <= 0) {
    const metTarget = earnedRaw >= targetGradePct;
    return metTarget
      ? `Target met — final grade ${earnedRaw.toFixed(1)}%.`
      : `Target missed — final grade ${earnedRaw.toFixed(1)}%.`;
  }

  const maxAchievable = earnedRaw + remainingWeight;
  if (maxAchievable < targetGradePct) {
    return `Target missed — even 100% on the remaining ${remainingWeight.toFixed(0)}% caps you at ${maxAchievable.toFixed(1)}%.`;
  }

  const neededPct = ((targetGradePct - earnedRaw) / remainingWeight) * 100;
  if (neededPct <= 0) {
    return `Already secured — ${targetGradePct}% is locked in no matter what's left.`;
  }

  return `Need ${neededPct.toFixed(1)}% across the remaining ${remainingWeight.toFixed(0)}%.`;
}
