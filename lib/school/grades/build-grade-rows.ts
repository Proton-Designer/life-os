import type { AssessmentGradeRow } from "./grade-ledger";

/**
 * `class_assessments` rows → the grade engine's input.
 *
 * WHY THIS TINY FILE HAS ITS OWN TEST SUITE.
 * The engine is already correct: an ungraded item does not drag a grade down, an excused
 * one is removed rather than zeroed, extra credit above 1.0 survives. Every one of those
 * proofs is DOWNSTREAM of this mapping. A single `?? 0` added here for convenience turns
 * "not graded yet" into a hard zero before the engine ever sees it — and every engine test
 * still passes, because the engine is being handed a lie rather than computing one.
 *
 * So this boundary is where null-is-never-zero is actually enforced, and the tests are
 * written as things the adapter must NOT do.
 *
 * A null here means, precisely: "no fact has been recorded." Not zero, not failing, not
 * excused. Three different states that a coalesce would flatten into one:
 *   points_earned = null   → not graded yet (excluded from the calculation)
 *   points_earned = 0      → graded, scored nothing (counts, and should)
 *   is_excused = true      → removed from the calculation entirely, denominator shrinks
 *
 * COLUMN TYPES ARE DECLARED LOCALLY, NOT TAKEN FROM `database.types.ts`.
 * That file does not know about migrations 105/106 — it was regenerated at 21:35 tonight,
 * after both were written, and contains zero occurrences of `points_earned`,
 * `points_possible`, `is_excused` or `weight_pct`. Same workaround `lib/school/get-class-cards.ts`
 * uses for 105's `classes` columns, for the same reason and with the same cost: this shape
 * is hand-maintained and will silently drift from the database until the types are
 * regenerated against a database that actually has these columns. Fix the generator, then
 * delete this comment and the local type.
 */
export interface AssessmentGradeSource {
  id: string;
  /** `class_assessments.weight_pct` (105). Null = no weight recorded, NOT 0% weight. */
  weight_pct: number | null;
  /** `class_assessments.points_earned` (106). Null = ungraded, never zero. */
  points_earned: number | null;
  /** `class_assessments.points_possible` (106). Null = ungraded. Strictly positive when set. */
  points_possible: number | null;
  /** `class_assessments.is_excused` (106). NOT NULL with a false default in the schema. */
  is_excused: boolean;
}

/**
 * Straight field-for-field mapping, snake to camel. No defaulting, no coalescing, no
 * inference — deliberately boring, and it should stay boring. If a future caller wants a
 * zero where a null is, it makes that decision at its own call site where a reader can see
 * it, not here where it would be invisible to every consumer at once.
 *
 * `is_excused` is carried, never inferred from an absent score: an ungraded row and an
 * excused row both have no earned points and are different facts.
 */
export function toAssessmentGradeRows(rows: readonly AssessmentGradeSource[]): AssessmentGradeRow[] {
  return rows.map((r) => ({
    id: r.id,
    weightPct: r.weight_pct,
    pointsEarned: r.points_earned,
    pointsPossible: r.points_possible,
    isExcused: r.is_excused,
  }));
}
