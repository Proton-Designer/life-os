import { computeCourseGrade, type ComputeCourseGradeOptions } from "./courseGrade";
import type { CourseGradeResult, GradeCategory, GradeItem } from "./types";

export interface GradeScenarioHypothetical {
  categoryId: string;
  assumedPct: number;
}

/**
 * Treats each hypothetical category as resolved at the assumed percentage, then
 * re-solves the rest.
 */
export function computeScenario(
  categories: GradeCategory[],
  items: GradeItem[],
  hypotheticals: GradeScenarioHypothetical[],
  options: Omit<ComputeCourseGradeOptions, "overrides"> = {},
): CourseGradeResult {
  const overrides = new Map(hypotheticals.map((h) => [h.categoryId, h.assumedPct]));
  return computeCourseGrade(categories, items, { ...options, overrides });
}
