import { PRACTICE_TEST_INTERVALS } from "@/lib/school/practice-test";

/**
 * P3-12 — practice-test vs real-grade benchmarking, honest insufficient-
 * data state.
 *
 * PURE, no I/O (same discipline as course-load-forecast.ts, P2-10): the
 * caller (lib/school/get-practice-benchmark-inputs.ts) already fetches
 * every graded assessment plus its completed practice tests; this only
 * shapes that into the comparison.
 *
 * ONE COMPARISON POINT PER ASSESSMENT, THE NEAREST-TO-EXAM COMPLETED
 * PRACTICE TEST — not an average across every interval taken. A T-1
 * practice score is a genuinely better predictor of "how did you actually
 * do" than a T-14 score from two weeks earlier, and averaging wildly
 * different time points into one number would obscure that rather than
 * inform it. `PRACTICE_TEST_INTERVALS` (lib/school/practice-test.ts, P2-09)
 * is the SAME ordered furthest-to-nearest list the assembly dispatcher
 * already uses — reused here, not re-derived, so "nearest" can never mean
 * something different in the two places that care about interval order.
 *
 * HONEST EMPTY STATE, same posture as course-load-forecast.ts: `hasData`
 * is false whenever no assessment has BOTH a real grade and at least one
 * completed practice test — the caller shows an explicit "not enough data
 * yet" message rather than an empty list that could read as "you have no
 * upcoming benchmarks" (a different, wrong claim).
 */

export interface CompletedPracticeTestInput {
  intervalLabel: string;
  scorePct: number;
}

export interface BenchmarkableAssessment {
  assessmentId: string;
  assessmentName: string;
  className: string;
  /** "YYYY-MM-DD" — the real exam's own date, for sort order. */
  date: string;
  /** 0-100, computed by the caller from points_earned/points_possible. */
  realPct: number;
  completedPracticeTests: CompletedPracticeTestInput[];
}

export interface BenchmarkRow {
  assessmentId: string;
  assessmentName: string;
  className: string;
  date: string;
  realPct: number;
  practicePct: number;
  practiceIntervalLabel: string;
  /** realPct - practicePct. Positive means you did BETTER on the real exam than practice predicted; negative means practice overstated it. */
  deltaPct: number;
}

export interface PracticeVsRealBenchmark {
  rows: BenchmarkRow[];
  hasData: boolean;
}

const INTERVAL_ORDER: readonly string[] = PRACTICE_TEST_INTERVALS.map((i) => i.label);

/** The completed practice test whose interval is CLOSEST to the exam (last in PRACTICE_TEST_INTERVALS' own furthest-to-nearest order) among this assessment's own completed set. Ties can't occur -- migration 185's own unique(user_id, assessment_id, interval_label) means at most one practice test per interval per assessment. */
function nearestToExam(tests: CompletedPracticeTestInput[]): CompletedPracticeTestInput {
  return [...tests].sort((a, b) => INTERVAL_ORDER.indexOf(b.intervalLabel) - INTERVAL_ORDER.indexOf(a.intervalLabel))[0]!;
}

export function computePracticeVsRealBenchmark(assessments: BenchmarkableAssessment[]): PracticeVsRealBenchmark {
  const rows: BenchmarkRow[] = assessments
    .filter((a) => a.completedPracticeTests.length > 0)
    .map((a) => {
      const nearest = nearestToExam(a.completedPracticeTests);
      return {
        assessmentId: a.assessmentId,
        assessmentName: a.assessmentName,
        className: a.className,
        date: a.date,
        realPct: a.realPct,
        practicePct: nearest.scorePct,
        practiceIntervalLabel: nearest.intervalLabel,
        deltaPct: a.realPct - nearest.scorePct,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // most recent exam first

  return { rows, hasData: rows.length > 0 };
}
