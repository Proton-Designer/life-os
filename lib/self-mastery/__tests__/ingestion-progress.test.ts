import { describe, it, expect } from "vitest";
import { estimateBookProgressPct } from "../ingestion-progress";

describe("estimateBookProgressPct", () => {
  it("returns null for done and failed -- those are the caller's own authoritative writers, not this estimate's", () => {
    expect(estimateBookProgressPct("done", null)).toBeNull();
    expect(estimateBookProgressPct("failed", null)).toBeNull();
  });

  it("returns a flat base for whole-book (non-chunked) stages regardless of chunkIndex", () => {
    expect(estimateBookProgressPct("queued", null)).toBe(2);
    expect(estimateBookProgressPct("chunking", null)).toBe(2);
    expect(estimateBookProgressPct("merging", null)).toBe(55);
    expect(estimateBookProgressPct("finalizing", null)).toBe(97);
  });

  it("climbs within extracting_lessons' span as chunkIndex increases", () => {
    const at0 = estimateBookProgressPct("extracting_lessons", 0)!;
    const at5 = estimateBookProgressPct("extracting_lessons", 5)!;
    const at50 = estimateBookProgressPct("extracting_lessons", 50)!;
    expect(at0).toBe(10);
    expect(at5).toBeGreaterThan(at0);
    expect(at50).toBeGreaterThan(at5);
  });

  it("never overtakes the next stage's own base -- saturates at extracting_lessons' ceiling (merging's base, 55)", () => {
    const farAlong = estimateBookProgressPct("extracting_lessons", 10_000)!;
    expect(farAlong).toBeLessThanOrEqual(55);
  });

  it("is monotonically non-decreasing across the whole real stage sequence at chunkIndex 0 -- the exact 'never see it go backwards' guarantee the UI depends on", () => {
    const sequence: [import("../types").IngestStage, number | null][] = [
      ["queued", null],
      ["chunking", null],
      ["extracting_lessons", 0],
      ["extracting_lessons", 20],
      ["merging", null],
      ["verifying_grounding", 0],
      ["verifying_grounding", 10],
      ["generating_cards", 0],
      ["generating_cards", 10],
      ["finalizing", null],
    ];
    let prev = -1;
    for (const [stage, chunkIndex] of sequence) {
      const pct = estimateBookProgressPct(stage, chunkIndex)!;
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
  });

  /**
   * REGRESSION SUITE (2026-09-15, the Lead's fix): book 3d7a3825 (203
   * source_chunks, 60 ranked lessons) sat visibly frozen at 55%/97% for
   * hours because the static PCT_PER_CHUNK curve saturates at a stage's
   * ceiling long before a real, larger book's true position gets there.
   * These assert the exact numbers from the Lead's own report.
   */
  describe("with a real total (the fix)", () => {
    it("THE REGRESSION GUARD: 203-chunk extraction at chunk 100 lands roughly mid-span (~32%), not saturated at 55", () => {
      const pct = estimateBookProgressPct("extracting_lessons", 100, 203)!;
      expect(pct).toBe(32); // base 10 + round(45 * 100/203) = 10 + 22
      expect(pct).toBeLessThan(55); // must NOT have saturated at the next stage's base
    });

    it("THE REGRESSION GUARD: 60-lesson card generation at lesson 30 lands ~86%, not saturated at 97", () => {
      const pct = estimateBookProgressPct("generating_cards", 30, 60)!;
      expect(pct).toBe(86); // base 75 + round(22 * 30/60) = 75 + 11
      expect(pct).toBeLessThan(97); // must NOT have saturated at finalizing's base
    });

    it("still climbs to the full span ceiling once position reaches total", () => {
      expect(estimateBookProgressPct("extracting_lessons", 203, 203)).toBe(55);
      expect(estimateBookProgressPct("generating_cards", 60, 60)).toBe(97);
    });

    it("clamps rather than overshoots if position somehow exceeds total", () => {
      expect(estimateBookProgressPct("extracting_lessons", 250, 203)).toBe(55);
    });

    it("falls back to the static curve when total is omitted, null, or non-positive -- never divides by zero, never throws", () => {
      const noTotal = estimateBookProgressPct("extracting_lessons", 5);
      const nullTotal = estimateBookProgressPct("extracting_lessons", 5, null);
      const zeroTotal = estimateBookProgressPct("extracting_lessons", 5, 0);
      const negativeTotal = estimateBookProgressPct("extracting_lessons", 5, -1);
      const fallbackExpected = 10 + Math.min(45, 5 * 2); // the unchanged PCT_PER_CHUNK curve
      expect(noTotal).toBe(fallbackExpected);
      expect(nullTotal).toBe(fallbackExpected);
      expect(zeroTotal).toBe(fallbackExpected);
      expect(negativeTotal).toBe(fallbackExpected);
    });
  });
});
