import type { CourseGradeResult } from "./types";

export interface GradeProjection {
  /** Earned average over graded weight only — unchanged from the engine's
   * own `currentGrade`, which was already correct. */
  currentGrade: number | null;
  /** The current average carried across ALL weight not yet graded — the
   * full `100 - gradedWeight`, whether or not that remaining weight has
   * been itemised into an assessment yet (R59). Null only when nothing is
   * graded at all: there is no average to carry forward. Never treats
   * ungraded/unassigned weight as already scored zero. */
  projectedGrade: number | null;
  /** How much of the 100% belongs to no assessment at all yet (weightSum <
   * 100) — null once every point of weight is itemised, graded or not. */
  unweightedPct: number | null;
}

function unweightedPctOf(course: CourseGradeResult): number | null {
  return course.weightSum < 100 ? 100 - course.weightSum : null;
}

/**
 * R59: a class's grade with an incomplete syllabus (weights not yet summing
 * to 100) is the case this exists for — it is the normal shape for most of a
 * semester, not an edge case. `currentGrade`/`projectedGrade` must agree on
 * what unassigned weight means, and the answer is: unknown, not zero.
 */
export function projectClassGrade(course: CourseGradeResult): GradeProjection {
  const resolved = course.categoryResults.filter((c) => c.resolved);
  const gradedWeight = resolved.reduce((s, c) => s + c.weightPct, 0);
  const unweightedPct = unweightedPctOf(course);

  if (gradedWeight === 0 || course.currentGrade == null) {
    return { currentGrade: null, projectedGrade: null, unweightedPct };
  }

  const earnedRaw = resolved.reduce((s, c) => s + (c.categoryPct as number) * c.weightPct, 0) / 100;
  const remainingWeight = 100 - gradedWeight;
  const projectedGrade =
    remainingWeight <= 0 ? course.currentGrade : earnedRaw + (course.currentGrade * remainingWeight) / 100;

  return { currentGrade: course.currentGrade, projectedGrade, unweightedPct };
}
