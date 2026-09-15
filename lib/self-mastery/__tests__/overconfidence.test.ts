import { describe, expect, it } from "vitest";
import { computeOverconfidenceVerdict, type ConfidenceOutcomePair } from "../overconfidence";

function pairs(spec: { confidence: "sure" | "think_so" | "guessing"; correct: boolean; n: number }[]): ConfidenceOutcomePair[] {
  return spec.flatMap((s) => Array.from({ length: s.n }, () => ({ confidence: s.confidence, correct: s.correct })));
}

describe("computeOverconfidenceVerdict", () => {
  it("below the total sample-size gate (20), returns insufficient_data -- never a fabricated verdict", () => {
    const result = computeOverconfidenceVerdict(pairs([{ confidence: "sure", correct: true, n: 19 }]));
    expect(result).toEqual({ status: "insufficient_data", sampleSize: 19, minimumRequired: 20 });
  });

  it("zero pairs is a real insufficient_data state, not an error", () => {
    const result = computeOverconfidenceVerdict([]);
    expect(result).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 20 });
  });

  it("well-calibrated data (sure is mostly right) reads as calibrated, not overconfident", () => {
    const result = computeOverconfidenceVerdict(
      pairs([
        { confidence: "sure", correct: true, n: 18 },
        { confidence: "sure", correct: false, n: 2 },
        { confidence: "guessing", correct: true, n: 5 },
      ]),
    );
    expect(result.status).toBe("calibrated");
    if (result.status === "calibrated") {
      const sure = result.buckets.find((b) => b.confidence === "sure")!;
      expect(sure.actualCorrectRate).toBeCloseTo(0.9);
    }
  });

  it("THE POSITIVE CASE: 'sure' actually right less than 85% of the time, with enough sure samples to trust it, reads as overconfident", () => {
    const result = computeOverconfidenceVerdict(
      pairs([
        { confidence: "sure", correct: true, n: 10 },
        { confidence: "sure", correct: false, n: 10 }, // 50% actual correct despite claiming "sure"
        { confidence: "guessing", correct: true, n: 5 },
      ]),
    );
    expect(result.status).toBe("overconfident");
    if (result.status === "overconfident") {
      expect(result.sureActualCorrectRate).toBeCloseTo(0.5);
    }
  });

  it("a 'sure' bucket below its own minimum sample (5) does NOT trigger overconfident, even if its rate looks bad -- one unlucky guess must never read as a pattern", () => {
    const result = computeOverconfidenceVerdict(
      pairs([
        { confidence: "sure", correct: false, n: 2 }, // 0% actual correct, but only 2 samples
        { confidence: "think_so", correct: true, n: 18 },
      ]),
    );
    expect(result.status).toBe("calibrated");
    if (result.status === "calibrated") {
      const sure = result.buckets.find((b) => b.confidence === "sure")!;
      expect(sure.belowMinimum).toBe(true);
    }
  });

  it("a bucket with zero samples reports actualCorrectRate: null, never a fabricated 0%", () => {
    const result = computeOverconfidenceVerdict(pairs([{ confidence: "think_so", correct: true, n: 20 }]));
    expect(result.status).toBe("calibrated");
    if (result.status === "calibrated") {
      const sure = result.buckets.find((b) => b.confidence === "sure")!;
      expect(sure.sampleSize).toBe(0);
      expect(sure.actualCorrectRate).toBeNull();
      expect(sure.belowMinimum).toBe(true);
    }
  });

  it("all three buckets are always present in the output, even when empty", () => {
    const result = computeOverconfidenceVerdict(pairs([{ confidence: "sure", correct: true, n: 20 }]));
    expect(result.status).toBe("calibrated");
    if (result.status === "calibrated") {
      expect(result.buckets.map((b) => b.confidence).sort()).toEqual(["guessing", "sure", "think_so"]);
    }
  });

  it("totalSample reflects the true total, not just the sure bucket", () => {
    const result = computeOverconfidenceVerdict(
      pairs([
        { confidence: "sure", correct: true, n: 10 },
        { confidence: "guessing", correct: false, n: 10 },
      ]),
    );
    if (result.status !== "insufficient_data") expect(result.totalSample).toBe(20);
  });

  it("exactly at the SURE_EXPECTED_MIN_CORRECT_RATE boundary (85%) is calibrated, not overconfident (strict <)", () => {
    const result = computeOverconfidenceVerdict(
      pairs([
        { confidence: "sure", correct: true, n: 17 },
        { confidence: "sure", correct: false, n: 3 }, // exactly 85%
      ]),
    );
    expect(result.status).toBe("calibrated");
  });
});
