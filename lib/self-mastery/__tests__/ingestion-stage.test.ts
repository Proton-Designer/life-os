import { describe, it, expect } from "vitest";
import { bucketIngestStage, looksUnclaimed } from "../ingestion-stage";

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
