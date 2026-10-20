import { describe, expect, it } from "vitest";
import { contentTypeLabel, percentReadSuffix } from "../types";

describe("contentTypeLabel", () => {
  it("names each reader source", () => {
    expect([contentTypeLabel("pdf"), contentTypeLabel("epub"), contentTypeLabel("url"), contentTypeLabel("paste"), contentTypeLabel("text")]).toEqual(["PDF", "EPUB", "Article", "Pasted text", "Text file"]);
  });
  it("a lesson-upload book (no reader source) with a file is a PDF; with nothing known it has no label (positive control: not 'PDF' for everything)", () => {
    expect(contentTypeLabel(null, true)).toBe("PDF");
    expect(contentTypeLabel(null, false)).toBeNull();
    expect(contentTypeLabel("epub", true)).toBe("EPUB");
  });
});

describe("percentReadSuffix", () => {
  it("is empty at 0% or unknown, and shows a real percentage (positive control)", () => {
    expect([percentReadSuffix(0), percentReadSuffix(null), percentReadSuffix(undefined)]).toEqual(["", "", ""]);
    expect(percentReadSuffix(42)).toBe(" · 42% read");
  });
});
