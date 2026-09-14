import { describe, it, expect } from "vitest";
import { bucketIngestStage, looksUnclaimed, looksStalled, STALLED_THRESHOLD_MS } from "../ingestion-stage";

describe("bucketIngestStage", () => {
  it("buckets the prep sub-stages together", () => {
    for (const s of ["queued", "extracting_text", "parsing_structure", "chunking", "embedding"] as const) {
      expect(bucketIngestStage(s)).toBe("prep");
    }
  });
  it("buckets card-building sub-stages together", () => {
    for (const s of ["merging", "generating_cards", "finalizing"] as const) {
      expect(bucketIngestStage(s)).toBe("cards");
    }
  });
  // RED before the fix (S6, 2026-09-14): IngestStage didn't list this value
  // and the switch had no case for it, so TypeScript's exhaustiveness check
  // never caught the gap and this returned `undefined` at runtime for any
  // book actually sitting in verifying_grounding -- a real, measured stage
  // (migration 109), not a hypothetical one.
  it("buckets verifying_grounding with the other card-building sub-stages (migration 109 -- was missing entirely)", () => {
    expect(bucketIngestStage("verifying_grounding")).toBe("cards");
  });
  it("treats failed the same as done for bucketing (status carries the failure, not stage)", () => {
    expect(bucketIngestStage("done")).toBe("done");
    expect(bucketIngestStage("failed")).toBe("done");
  });
});

describe("looksUnclaimed", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("is false for a fresh queued book", () => {
    expect(looksUnclaimed("queued", now, now)).toBe(false);
  });

  it("is true once a queued book has waited past the threshold", () => {
    const createdAt = new Date(now.getTime() - 3 * 60 * 1000);
    expect(looksUnclaimed("queued", createdAt, now)).toBe(true);
  });

  it("is false for a non-queued stage regardless of age (it was claimed)", () => {
    const createdAt = new Date(now.getTime() - 10 * 60 * 1000);
    expect(looksUnclaimed("extracting_text", createdAt, now)).toBe(false);
  });
});

describe("looksStalled", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("is false when there is no job row to check (e.g. a seeded starter deck)", () => {
    expect(looksStalled("extracting_lessons", null, now)).toBe(false);
  });

  it("is false for queued (looksUnclaimed's job, not this one's)", () => {
    const staleUpdate = new Date(now.getTime() - STALLED_THRESHOLD_MS - 1000);
    expect(looksStalled("queued", staleUpdate, now)).toBe(false);
  });

  it("is false for done/failed regardless of age", () => {
    const staleUpdate = new Date(now.getTime() - STALLED_THRESHOLD_MS - 1000);
    expect(looksStalled("done", staleUpdate, now)).toBe(false);
    expect(looksStalled("failed", staleUpdate, now)).toBe(false);
  });

  it("is false for a mid-pipeline stage still within the threshold (genuinely slow, not stalled)", () => {
    const recentUpdate = new Date(now.getTime() - (STALLED_THRESHOLD_MS - 1000));
    expect(looksStalled("extracting_lessons", recentUpdate, now)).toBe(false);
  });

  it("is true for a mid-pipeline stage that hasn't been touched past the threshold", () => {
    const staleUpdate = new Date(now.getTime() - STALLED_THRESHOLD_MS - 1000);
    expect(looksStalled("generating_cards", staleUpdate, now)).toBe(true);
  });
});
