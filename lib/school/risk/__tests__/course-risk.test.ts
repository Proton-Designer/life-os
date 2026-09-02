import { describe, expect, it } from "vitest";
import { computeCourseRisk } from "../course-risk";

// Mirrors CollegeOS packages/core/src/risk/courseRisk.test.ts.

describe("computeCourseRisk", () => {
  it("is dominated by the worst item, not diluted by the mean", () => {
    const result = computeCourseRisk({
      items: [
        { id: "a", score: 90 },
        { id: "b", score: 10 },
        { id: "c", score: 10 },
        { id: "d", score: 10 },
      ],
    });
    expect(result.score).toBeGreaterThan(80);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("rises above the single max when several items are concurrently high", () => {
    const singleHigh = computeCourseRisk({ items: [{ id: "a", score: 80 }, { id: "b", score: 5 }] });
    const twoHigh = computeCourseRisk({ items: [{ id: "a", score: 80 }, { id: "b", score: 80 }] });
    expect(twoHigh.score).toBeGreaterThanOrEqual(singleHigh.score);
  });

  it("caps at 100", () => {
    const result = computeCourseRisk({ items: [{ id: "a", score: 100 }, { id: "b", score: 100 }] });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("equals the single item score when there is only one item", () => {
    const result = computeCourseRisk({ items: [{ id: "a", score: 42 }] });
    expect(result.score).toBe(42);
  });

  it("reports insufficient confidence with no items", () => {
    const result = computeCourseRisk({ items: [] });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("insufficient");
    expect(result.sampleSize).toBe(0);
  });

  it("assigns a band consistent with the assignment-risk bands", () => {
    const result = computeCourseRisk({ items: [{ id: "a", score: 90 }, { id: "b", score: 10 }] });
    expect(result.band).toBe("critical");
  });

  it("carries a trace entry per item", () => {
    const result = computeCourseRisk({ items: [{ id: "a", score: 90 }, { id: "b", score: 10 }, { id: "c", score: 10 }] });
    expect(result.trace).toHaveLength(3);
    expect(result.trace.map((t) => t.key)).toEqual(["a", "b", "c"]);
  });
});
