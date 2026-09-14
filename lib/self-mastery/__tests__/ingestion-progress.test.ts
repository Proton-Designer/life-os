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
});
