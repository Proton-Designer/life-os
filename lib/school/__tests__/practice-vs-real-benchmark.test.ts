import { describe, it, expect } from "vitest";
import { computePracticeVsRealBenchmark, type BenchmarkableAssessment } from "../practice-vs-real-benchmark";

function assessment(overrides: Partial<BenchmarkableAssessment> = {}): BenchmarkableAssessment {
  return {
    assessmentId: "a1",
    assessmentName: "Midterm",
    className: "Calc II",
    date: "2026-10-01",
    realPct: 85,
    completedPracticeTests: [],
    ...overrides,
  };
}

describe("computePracticeVsRealBenchmark (P3-12)", () => {
  it("hasData is false, rows empty, when nothing has a completed practice test", () => {
    const result = computePracticeVsRealBenchmark([assessment({ completedPracticeTests: [] })]);
    expect(result).toEqual({ rows: [], hasData: false });
  });

  it("hasData is true and computes the delta for an assessment with one completed practice test", () => {
    const result = computePracticeVsRealBenchmark([assessment({ realPct: 85, completedPracticeTests: [{ intervalLabel: "T-7", scorePct: 70 }] })]);
    expect(result.hasData).toBe(true);
    expect(result.rows).toEqual([
      { assessmentId: "a1", assessmentName: "Midterm", className: "Calc II", date: "2026-10-01", realPct: 85, practicePct: 70, practiceIntervalLabel: "T-7", deltaPct: 15 },
    ]);
  });

  it("picks the NEAREST-to-exam completed practice test, not an average, when several were taken", () => {
    const result = computePracticeVsRealBenchmark([
      assessment({
        realPct: 90,
        completedPracticeTests: [
          { intervalLabel: "T-14", scorePct: 40 },
          { intervalLabel: "T-1", scorePct: 88 },
          { intervalLabel: "T-7", scorePct: 60 },
        ],
      }),
    ]);
    expect(result.rows[0]!.practiceIntervalLabel).toBe("T-1");
    expect(result.rows[0]!.practicePct).toBe(88);
    expect(result.rows[0]!.deltaPct).toBe(2);
  });

  it("a negative delta (did worse on the real exam than practice predicted) is reported honestly, not clamped", () => {
    const result = computePracticeVsRealBenchmark([assessment({ realPct: 55, completedPracticeTests: [{ intervalLabel: "T-1", scorePct: 90 }] })]);
    expect(result.rows[0]!.deltaPct).toBe(-35);
  });

  it("sorts most-recent-exam first, and only includes assessments with at least one completed practice test", () => {
    const result = computePracticeVsRealBenchmark([
      assessment({ assessmentId: "old", date: "2026-09-01", completedPracticeTests: [{ intervalLabel: "T-1", scorePct: 80 }] }),
      assessment({ assessmentId: "no-practice", date: "2026-09-15", completedPracticeTests: [] }),
      assessment({ assessmentId: "new", date: "2026-10-15", completedPracticeTests: [{ intervalLabel: "T-1", scorePct: 80 }] }),
    ]);
    expect(result.rows.map((r) => r.assessmentId)).toEqual(["new", "old"]);
  });
});
