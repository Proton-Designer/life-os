import type { Database } from "@/lib/supabase/database.types";
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
 * THE SHAPE IS DERIVED FROM THE GENERATED TYPES, NOT HAND-DECLARED.
 * It briefly was hand-declared: `database.types.ts` did not know about migrations
 * 105/106, so this file and `lib/school/get-class-cards.ts` each carried their own copy
 * of the column shape. That is drift becoming code -- two hand-maintained mirrors of a
 * schema, with nothing to make them disagree out loud. Fixed at the source (8eda53c,
 * regenerated from production, and regeneration is now automatic after every production
 * apply), so the local type is gone.
 *
 * A `Pick` rather than the whole Row on purpose: a caller should be able to `select` just
 * these five columns without having to satisfy every field of the table. The Pick still
 * fails to compile if any of the five is renamed or retyped, which is the guarantee the
 * hand-declared version could not give.
 */
type ClassAssessmentRow = Database["public"]["Tables"]["class_assessments"]["Row"];

export type AssessmentGradeSource = Pick<
  ClassAssessmentRow,
  "id" | "weight_pct" | "points_earned" | "points_possible" | "is_excused"
>;

/**
 * Straight field-for-field mapping, snake to camel. No defaulting, no coalescing, no
 * inference -- deliberately boring, and it should stay boring. If a future caller wants a
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
