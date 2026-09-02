import { describe, it, expect } from "vitest";
import { chunkBook } from "../chunk";
import type { DetectedSection, ExtractedPage } from "../types";

function makePage(page: number, text: string): ExtractedPage {
  return { page, text };
}

function section(title: string, pageStart: number, pageEnd: number, sortOrder = 0): DetectedSection {
  return { title, sortOrder, pageStart, pageEnd, level: 1 };
}

describe("chunkBook", () => {
  it("returns no chunks for an empty book", () => {
    expect(chunkBook([], [])).toEqual([]);
  });

  it("drops skippable sections (front/back matter) entirely", () => {
    const pages = [makePage(1, "Copyright notice text goes here, quite long really.")];
    const sections = [section("Copyright", 1, 1)];
    expect(chunkBook(pages, sections)).toEqual([]);
  });

  it("produces at least one chunk for a real section with real sentences", () => {
    const pages = [makePage(1, "This is a real sentence about a real topic. It has more than one sentence in it.")];
    const sections = [section("Chapter 1", 1, 1)];
    const result = chunkBook(pages, sections);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.sectionIndex).toBe(0);
  });

  it("keeps chunk sortOrder strictly increasing and starting at 0 across multiple sections", () => {
    const pages = [
      makePage(1, "First section has this sentence. And this one too, for good measure."),
      makePage(2, "Second section has a different sentence. With another one right after it."),
    ];
    const sections = [section("Chapter 1", 1, 1, 0), section("Chapter 2", 2, 2, 1)];
    const result = chunkBook(pages, sections);
    const sortOrders = result.map((c) => c.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
    expect(new Set(sortOrders).size).toBe(sortOrders.length); // no duplicates
    expect(sortOrders[0]).toBe(0);
  });

  it("never emits a chunk whose estimated token count exceeds the hard cap (4000 tokens)", () => {
    // One enormous run-on "sentence" (no terminal punctuation at all) —
    // the ULM L6 §3 failure-injection shape: a table/index/OCR artefact.
    const hugeSentence = "word ".repeat(30000).trim(); // ~150,000 chars, no '.', '!' or '?'
    const pages = [makePage(1, hugeSentence)];
    const sections = [section("Chapter 1", 1, 1)];
    const result = chunkBook(pages, sections);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(4000);
    }
  });

  it("records the correct page range for a chunk spanning multiple pages", () => {
    const pages = [
      makePage(1, "Page one sentence here, reasonably long so it counts."),
      makePage(2, "Page two continues the same section with more content."),
    ];
    const sections = [section("Chapter 1", 1, 2)];
    const result = chunkBook(pages, sections);
    expect(result[0]!.pageStart).toBe(1);
    expect(result.at(-1)!.pageEnd).toBe(2);
  });
});
