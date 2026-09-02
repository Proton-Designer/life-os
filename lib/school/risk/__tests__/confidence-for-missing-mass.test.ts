import { describe, expect, it } from "vitest";
import { confidenceForMissingMass } from "../assignment-risk";

// RED TEST (2026-09-02, Lead brief): today's universal missing set (difficulty 0.08 +
// knowledgeGap 0.15 + gradeHeadroom 0.12) sums to exactly 0.35 in the order it's pushed,
// but IEEE754 addition is not associative — summed in a different order it's
// 0.35000000000000003, one ULP over the "low" threshold. Without an epsilon on that
// threshold, the middle case below reads "insufficient" instead of "low": a pure
// float-ordering artifact producing a different confidence for identical missing data.
// This file failed on exactly that assertion before assignment-risk.ts's epsilon; the
// mutation check (temporarily reverting the epsilon) reproduces it on demand.

describe("confidenceForMissingMass", () => {
  it("returns high only at exactly zero missing mass", () => {
    expect(confidenceForMissingMass(0)).toBe("high");
    expect(confidenceForMissingMass(0.01)).not.toBe("high");
  });

  it("is insensitive to float noise at the 0.15 boundary", () => {
    expect(confidenceForMissingMass(0.15)).toBe("moderate");
    expect(confidenceForMissingMass(0.15000000000000003)).toBe("moderate"); // the red
    expect(confidenceForMissingMass(0.16)).toBe("low"); // epsilon must not widen the band
  });

  it("is insensitive to float noise at the 0.35 boundary — today's universal missing-mass case", () => {
    expect(confidenceForMissingMass(0.35)).toBe("low");
    expect(confidenceForMissingMass(0.35000000000000003)).toBe("low"); // the red
    expect(confidenceForMissingMass(0.36)).toBe("insufficient"); // epsilon must not widen the band
  });

  it("proves the two float-sum orders of today's universal missing set actually agree", () => {
    const forwardOrder = 0.08 + 0.15 + 0.12; // difficulty, knowledgeGap, gradeHeadroom push order
    const reverseOrder = 0.12 + 0.15 + 0.08;
    expect(confidenceForMissingMass(forwardOrder)).toBe(confidenceForMissingMass(reverseOrder));
  });
});
