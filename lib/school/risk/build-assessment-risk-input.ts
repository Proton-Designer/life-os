import type { AssignmentRiskInput } from "./assignment-risk";
import type { LocalDate } from "./types";

// The adapter CollegeOS's own migration comment (supabase/migrations/105_school_risk_inputs.sql)
// said would be needed: "the adapter decides what an unknown weight becomes; the column
// refuses to pretend it knows." Mirrors packages/api/src/day/risk.ts's assembly, adjusted
// for what LifeOS's schema actually has today.

/**
 * Population-average start-delay the procrastination factor falls back to below 5 personal
 * observations (assignment-risk.ts's own doc comment). **A prior, not a measurement** —
 * School has no per-user start-delay history table yet. Matches CollegeOS's own
 * GLOBAL_MEAN_START_DELAY_DAYS_PRIOR (packages/api/src/day/risk.ts) so the same input
 * produces the same score in both products; if that constant ever moves there, move it here
 * too. Not exported — a UI rendering "1.5 days average" would present a made-up placeholder
 * as an observed fact, exactly the fabrication this product refuses everywhere else.
 */
const GLOBAL_MEAN_START_DELAY_DAYS_PRIOR = 1.5;

/**
 * `AssignmentRiskInput.committedHours`/`availableHours` (congestion) want a real
 * calendar-busy signal. LifeOS's `classes`/`class_assessments` schema has none — migration
 * 105's own comment is explicit that this is deliberate: synthesising busy-time would
 * fabricate the exact number the engine is meant to measure. `committedHours: 0` is an
 * honest statement of "zero known commitments," not an invented one. `availableHours` only
 * needs to be positive to avoid a divide-by-zero; its value is otherwise inert while
 * committedHours stays 0, so it is not a second guess dressed up as data.
 */
const NO_CALENDAR_BUSY_SOURCE = { committedHours: 0, availableHours: 1 } as const;

export interface AssessmentRiskFacts {
  today: LocalDate;
  dueDate: LocalDate;
  /** `class_assessments.weight_pct` — null means unknown, never zero weight (the column's
   * own contract). The adapter must still hand the engine a number, so an unknown weight
   * becomes 0 here — the same call CollegeOS's own adapter makes for a deliverable with no
   * grade-item weight (packages/api/src/day/risk.ts). It costs *this* assessment's weight
   * factor, never another one's.
   *
   * KNOWN EDGE, not yet a problem (Lead review, 2026-09-02): `weightPct` is the only
   * per-assessment risk input and is never excludable — `AssignmentRiskInput.weightPct` is
   * required, not optional, so this adapter has no "exclude" path for it the way it does
   * for difficulty/confidence/target. Today every real `weight_pct` is null, so every
   * assessment gets 0 uniformly and the factor contributes nothing to anyone — harmless.
   * The moment a user weights SOME assessments and not others, the unweighted ones will
   * rank as if genuinely worth 0% of the grade — "no evidence read as a low value," the
   * exact failure R28 exists to prevent, one level up. The real fix is engine-side (make
   * weight excludable like the other three); this adapter has no better option until then. */
  weightPct: number | null;
  /** `classes.difficulty_rating` — null excludes the factor (never defaulted). */
  difficultyRating: number | null;
  /** `classes.confidence_rating` — null excludes the factor (never defaulted). */
  confidenceRating: number | null;
  /** `classes.target_grade_pct` — null excludes gradeHeadroom, independent of projectedPct. */
  targetGradePct: number | null;
  /** A projected class grade, when a grade engine (106) supplies one. Absent today — every
   * call site currently omits this, so gradeHeadroom stays excluded for every assessment
   * until 106 lands, which is the correct behavior: a target with no projection is an
   * aspiration, not a measurement (105's own comment). */
  projectedGradePct?: number | null;
}

/**
 * `completedUnits`/`plannedUnits` (the `unfinished` factor) want a per-assessment
 * work-progress signal. School has no such model — an assessment has at most one linked
 * task (`class_assessments.task_id`), and that task's own completion is "did you do the
 * one administrative step of creating a task for this," not "how much prep is done,"
 * so treating it as a completion fraction would be a modeling stretch this schema
 * doesn't support yet. `plannedUnits: 0` is honest here: DOMAIN_ENGINE_SPEC.md and
 * assignment-risk.ts both define `plannedUnits === 0` as "nothing planned" — a real,
 * always-applicable signal for this schema, never treated as missing data.
 */
export function buildAssessmentRiskInput(facts: AssessmentRiskFacts): AssignmentRiskInput {
  return {
    today: facts.today,
    dueDate: facts.dueDate,
    weightPct: facts.weightPct ?? 0,
    ...NO_CALENDAR_BUSY_SOURCE,
    plannedUnits: 0,
    completedUnits: 0,
    globalMeanStartDelayDays: GLOBAL_MEAN_START_DELAY_DAYS_PRIOR,
    ...(facts.difficultyRating != null ? { difficultyRating: facts.difficultyRating } : {}),
    ...(facts.confidenceRating != null ? { confidenceRating: facts.confidenceRating } : {}),
    ...(facts.targetGradePct != null ? { targetPct: facts.targetGradePct } : {}),
    ...(facts.projectedGradePct != null ? { projectedPct: facts.projectedGradePct } : {}),
  };
}
