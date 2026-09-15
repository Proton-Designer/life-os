/**
 * Phase 2 #P2-08 — overconfidence / illusion-of-competence detector.
 *
 * PURE, no I/O: compares a confidence tap (`reviews.confidence`,
 * migration 085) against the SAME row's real graded outcome
 * (`reviews.correct`) — never a self-reported one. Deliberately reuses
 * `reviews`, NOT a new table: that table already covers both ULM
 * self-mastery flashcard reviews (`card_id`) and School's Question Bank
 * reviews (`question_id`) — the same "one table, two domains" shape
 * migration 057's own comment already established for `work_sessions`.
 * `practice_test_answers.self_reported_correct` was considered and
 * rejected as a data source: it has no confidence column, and no
 * independently-graded outcome to compare a self-report against — there
 * is nothing to detect overconfidence FROM in that table alone.
 *
 * HONEST EMPTY STATE, TWO LEVELS: an overall sample-size gate
 * (`MIN_TOTAL_SAMPLE`) before saying anything at all — this is a
 * statistical claim about a pattern across many independent trials, not a
 * single-fact lookup, so it needs more evidence than e.g.
 * assignment-risk.ts's own `MIN_PERSONAL_START_DELAY_SAMPLE = 5` (a single
 * personal-average input, not a three-way calibration check) — AND a
 * per-bucket minimum (`MIN_BUCKET_SAMPLE`) before drawing a conclusion
 * about any ONE confidence level specifically, so a single "sure" answer
 * that happened to be wrong can never read as "you're overconfident."
 */

export type ConfidenceLevel = "sure" | "think_so" | "guessing";
const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["sure", "think_so", "guessing"];

export interface ConfidenceOutcomePair {
  confidence: ConfidenceLevel;
  correct: boolean;
}

/** Below this many total confidence+outcome pairs, no verdict is drawn at all — a three-bucket calibration claim needs real breadth of evidence. */
const MIN_TOTAL_SAMPLE = 20;
/** Below this many pairs IN A GIVEN BUCKET, that bucket's own actual-correct-rate is not reported as a finding (it still appears in the output for transparency, with `belowMinimum: true`, but never drives the verdict). */
const MIN_BUCKET_SAMPLE = 5;
/** A "sure" answer should usually be right. Below this actual-correct-rate, with enough "sure" samples to trust the number, that's the illusion of competence this feature exists to catch. */
const SURE_EXPECTED_MIN_CORRECT_RATE = 0.85;

export interface ConfidenceBucketStats {
  confidence: ConfidenceLevel;
  sampleSize: number;
  /** 0-1, or null when sampleSize is 0 (never a fabricated 0%). */
  actualCorrectRate: number | null;
  belowMinimum: boolean;
}

function computeBucketStats(pairs: ConfidenceOutcomePair[]): ConfidenceBucketStats[] {
  return CONFIDENCE_LEVELS.map((level) => {
    const inBucket = pairs.filter((p) => p.confidence === level);
    const correctCount = inBucket.filter((p) => p.correct).length;
    return {
      confidence: level,
      sampleSize: inBucket.length,
      actualCorrectRate: inBucket.length > 0 ? correctCount / inBucket.length : null,
      belowMinimum: inBucket.length < MIN_BUCKET_SAMPLE,
    };
  });
}

export type OverconfidenceVerdict =
  | { status: "insufficient_data"; sampleSize: number; minimumRequired: number }
  | { status: "calibrated"; buckets: ConfidenceBucketStats[]; totalSample: number }
  | { status: "overconfident"; buckets: ConfidenceBucketStats[]; totalSample: number; sureActualCorrectRate: number };

export function computeOverconfidenceVerdict(pairs: ConfidenceOutcomePair[]): OverconfidenceVerdict {
  if (pairs.length < MIN_TOTAL_SAMPLE) {
    return { status: "insufficient_data", sampleSize: pairs.length, minimumRequired: MIN_TOTAL_SAMPLE };
  }

  const buckets = computeBucketStats(pairs);
  const sureBucket = buckets.find((b) => b.confidence === "sure")!;

  if (!sureBucket.belowMinimum && sureBucket.actualCorrectRate !== null && sureBucket.actualCorrectRate < SURE_EXPECTED_MIN_CORRECT_RATE) {
    return { status: "overconfident", buckets, totalSample: pairs.length, sureActualCorrectRate: sureBucket.actualCorrectRate };
  }

  return { status: "calibrated", buckets, totalSample: pairs.length };
}
