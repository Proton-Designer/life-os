import { describe, expect, it } from "vitest";
import { processingLabel } from "../ingestion-stage";

describe("processingLabel", () => {
  it("names the real stage and the real percentage", () => {
    expect(processingLabel("extracting_lessons", 54)).toBe("Finding lessons · 54%");
    expect(processingLabel("generating_cards", 82)).toBe("Building your deck · 82%");
    expect(processingLabel("chunking", 10)).toBe("Reading your book · 10%");
  });
  it("shows no percentage at 0 or when it is unknown, and never over 99 while still processing", () => {
    expect(processingLabel("queued", 0)).toBe("Reading your book");
    expect(processingLabel("merging", Number.NaN)).toBe("Building your deck");
    expect(processingLabel("finalizing", 100)).toBe("Building your deck · 99%");
  });
});
