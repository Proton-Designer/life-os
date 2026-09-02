import { computeCourseGrade } from "./courseGrade";
import type { CourseGradeResult, GradeCategory, GradeItem } from "./types";

/**
 * One `class_assessments` row's grade-relevant columns (migrations 105/106).
 * `weightPct`, `pointsEarned`, and `pointsPossible` are all nullable because
 * grading is net-new capture here — most of a semester's assessments exist
 * with a name and a date and nothing else yet.
 */
export interface AssessmentGradeRow {
  id: string;
  weightPct: number | null;
  pointsEarned: number | null;
  pointsPossible: number | null;
  isExcused: boolean;
}

/**
 * Adapts LifeOS's flat, per-assessment rows into the engine's category/item
 * model. CollegeOS's `grade_categories` (drop-lowest-N, an expected item
 * count, several items per category) is not ported — each assessment is its
 * own single-item category: `{ weightPct, dropLowestN: 0, expectedItemCount: 1 }`.
 * That is the least schema surface that still computes a true current /
 * projected / required-score grade; it cannot express drop-the-lowest-quiz,
 * a known and accepted gap.
 *
 * Two rows are dropped before they ever reach the engine, not passed through
 * with a placeholder:
 *
 * - `isExcused` rows are omitted entirely — no category, no item. Passing an
 *   excused item into a category the engine still resolves would leave its
 *   weight sitting in `remainingWeight` (assumed to score like the class
 *   average via the 'current' assumption), which is exactly the "must not be
 *   there at all" invariant this feature exists to protect.
 * - Rows with `weightPct == null` are omitted — an assessment the user
 *   hasn't assigned a weight to yet cannot contribute a percentage to a
 *   weighted average, and including it at weight 0 would be indistinguishable
 *   from "worth nothing," which is not what an unset weight means.
 *
 * A row with `pointsPossible == null` (not yet graded) still gets a category
 * — its weight belongs in the ledger's remaining weight — but no `GradeItem`,
 * since the engine's `GradeItem.pointsPossible` is a real number, not a
 * "maybe." An empty category resolves to `categoryPct: null`, never 0.
 */
export function computeClassGrade(rows: AssessmentGradeRow[]): CourseGradeResult {
  const inScope = rows.filter((r) => !r.isExcused && r.weightPct != null);

  const categories: GradeCategory[] = inScope.map((r) => ({
    id: r.id,
    name: r.id,
    weightPct: r.weightPct as number,
    dropLowestN: 0,
    expectedItemCount: 1,
  }));

  const items: GradeItem[] = inScope
    .filter((r) => r.pointsPossible != null)
    .map((r) => ({
      id: r.id,
      categoryId: r.id,
      name: r.id,
      pointsEarned: r.pointsEarned,
      pointsPossible: r.pointsPossible as number,
      isExcused: false,
    }));

  return computeCourseGrade(categories, items);
}
