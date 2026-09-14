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
  /**
   * `class_assessments.category_id` (migration 152, Phase 1 #11) — which
   * `grade_categories` row this assessment belongs to, or null. Optional
   * (not just nullable) so every pre-152 caller that never heard of
   * categories keeps compiling and behaving identically: an object literal
   * that omits this field is exactly as valid as one that sets it to null,
   * and `computeClassGrade` treats the two identically (see below).
   */
  categoryId?: string | null;
}

/**
 * A real weight category (migration 152's `grade_categories`: drop-lowest-N,
 * an expected item count, several items per category) — CollegeOS's actual
 * model, finally portable now that the schema exists. Deliberately the same
 * shape as the engine's own `GradeCategory` (lib/school/grades/types.ts)
 * rather than a second, parallel type: this table's row already IS a
 * `GradeCategory`, id for id.
 */
export type GradeCategoryDefinition = GradeCategory;

/**
 * Adapts LifeOS's flat, per-assessment rows into the engine's category/item
 * model — additively extended (migration 152) to also support REAL weight
 * categories when a class has defined them via `categoryDefs`, without
 * changing one line of behavior for a class that hasn't.
 *
 * THE ORIGINAL, STILL-DEFAULT SHAPE (categoryDefs omitted or `[]`): each
 * assessment is its own single-item synthetic category —
 * `{ weightPct, dropLowestN: 0, expectedItemCount: 1 }`. That is the least
 * schema surface that still computes a true current/projected/required-
 * score grade; it cannot express drop-the-lowest-quiz on its own.
 *
 * THE NEW SHAPE, additive: an assessment whose `categoryId` names one of the
 * `categoryDefs` passed in is grouped under that REAL category instead —
 * weight, dropLowestN and expectedItemCount all come from the category
 * (CollegeOS's actual model), not from the assessment. An assessment with no
 * `categoryId`, or one pointing at a category this call didn't pass in,
 * keeps the original synthetic-category treatment exactly as before — a
 * class can have some assessments filed under real categories and others
 * not yet (a user assigning categories one at a time), and each is scored
 * correctly on its own terms. Every `categoryDefs` entry is included in the
 * computation even if nothing is filed under it yet: a declared-but-empty
 * category is real, unearned weight (the same null-is-never-zero rule
 * migration 105/106 apply everywhere else), not zero and not absent — the
 * engine's own `resolveCategory` already renders that correctly as
 * `categoryPct: null, resolved: false`, folded into remaining weight.
 *
 * Two kinds of rows are dropped before they ever reach the engine, not
 * passed through with a placeholder, exactly as before:
 *
 * - `isExcused` rows are omitted entirely — no category, no item. Passing an
 *   excused item into a category the engine still resolves would leave its
 *   weight sitting in `remainingWeight` (assumed to score like the class
 *   average via the 'current' assumption), which is exactly the "must not be
 *   there at all" invariant this feature exists to protect.
 * - Rows with `weightPct == null` are omitted from the SYNTHETIC path only
 *   (a categorized row's weight comes from its category, not its own
 *   weightPct, so it is never excluded on this basis) — an uncategorized
 *   assessment the user hasn't assigned a weight to yet cannot contribute a
 *   percentage to a weighted average, and including it at weight 0 would be
 *   indistinguishable from "worth nothing," which is not what an unset
 *   weight means.
 *
 * A row with `pointsPossible == null` (not yet graded) still gets a category
 * — its weight belongs in the ledger's remaining weight — but no `GradeItem`,
 * since the engine's `GradeItem.pointsPossible` is a real number, not a
 * "maybe." An empty category resolves to `categoryPct: null`, never 0.
 */
/**
 * The categories/items construction `computeClassGrade` uses internally,
 * exported so a second caller (the scenario "what-if" solver, Phase 1 #13 —
 * see `scenario.ts`'s `computeScenario`, which operates on these same engine
 * types) reuses this exact mapping rather than re-deriving it. Two
 * implementations of "which category does this assessment belong to" is
 * precisely the kind of drift this file's own header exists to prevent.
 */
export function buildCategoriesAndItems(
  rows: AssessmentGradeRow[],
  categoryDefs: GradeCategoryDefinition[] = [],
): { categories: GradeCategory[]; items: GradeItem[] } {
  const categoryIds = new Set(categoryDefs.map((c) => c.id));
  const isRealCategoryRow = (r: AssessmentGradeRow) => !r.isExcused && r.categoryId != null && categoryIds.has(r.categoryId);
  // Excludes rows already claimed by a real category above -- a categorized
  // row's weight comes from its category, never its own weightPct, so it is
  // never excluded on the weightPct==null basis below (an uncategorized row
  // with no weightPct is the ONLY thing this basis is about).
  const isSyntheticRow = (r: AssessmentGradeRow) => !r.isExcused && !isRealCategoryRow(r) && r.weightPct != null;

  const categorizedRows = rows.filter(isRealCategoryRow);
  const syntheticRows = rows.filter(isSyntheticRow);

  const categories: GradeCategory[] = [
    ...categoryDefs,
    ...syntheticRows.map((r) => ({
      id: r.id,
      name: r.id,
      weightPct: r.weightPct as number,
      dropLowestN: 0,
      expectedItemCount: 1,
    })),
  ];

  const items: GradeItem[] = [
    ...categorizedRows
      .filter((r) => r.pointsPossible != null)
      .map((r) => ({
        id: r.id,
        categoryId: r.categoryId as string,
        name: r.id,
        pointsEarned: r.pointsEarned,
        pointsPossible: r.pointsPossible as number,
        isExcused: false,
      })),
    ...syntheticRows
      .filter((r) => r.pointsPossible != null)
      .map((r) => ({
        id: r.id,
        categoryId: r.id,
        name: r.id,
        pointsEarned: r.pointsEarned,
        pointsPossible: r.pointsPossible as number,
        isExcused: false,
      })),
  ];

  return { categories, items };
}

export function computeClassGrade(
  rows: AssessmentGradeRow[],
  categoryDefs: GradeCategoryDefinition[] = [],
): CourseGradeResult {
  const { categories, items } = buildCategoriesAndItems(rows, categoryDefs);
  return computeCourseGrade(categories, items);
}
