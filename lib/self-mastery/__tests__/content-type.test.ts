import { describe, expect, it } from "vitest";
import { contentTypeLabel } from "../types";

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
