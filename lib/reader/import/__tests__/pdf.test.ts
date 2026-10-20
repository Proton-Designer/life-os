import { describe, expect, it } from "vitest";
import { importPdf } from "../pdf";
import { ReaderImportError } from "../errors";
import { makePdf } from "./helpers";

const WORDS = ["river", "stone", "lantern", "orchard", "winter", "compass", "meadow", "harbor", "violin", "saddle", "thunder", "paper"];
const sentence = (n: number, k: number) =>
  `${WORDS[(n + k) % 12]} ${WORDS[(n * 5 + k * 3) % 12]} and ${WORDS[(n * 7 + k) % 12]} number ${n * 10 + k} keeps the reader moving along nicely.`;
// 12 distinct body lines per page so the 2-line top/bottom edge is a small fraction, like a real page.
const bodyPage = (n: number, header = true) => [
  ...(header ? ["Running Header Of The Book"] : []),
  ...(n === 1 ? ["The quick brown fox jumps over the lazy dog on page one."] : []),
  ...Array.from({ length: 12 }, (_, k) => sentence(n, k)).flatMap((l, k) => (k % 6 === 5 ? [l, `Closing ${WORDS[(n * 5 + k) % 12]} thought.`] : [l])), // short last line = paragraph end
  ...(header ? [String(n)] : []),
];

describe("importPdf", () => {
  const pages = [1, 2, 3, 4].map((n) => ({ lines: bodyPage(n) }));

  it("extracts text, strips running headers + page numbers, reads metadata, builds outline chapters", async () => {
    const bytes = makePdf(pages, [{ title: "First part", page: 1 }, { title: "Third part", page: 3 }], { title: "Meta Title", author: "Meta Author" });
    const r = await importPdf(bytes);
    const all = r.blocks.map((b) => b.text).join(" ");
    expect(all).toContain("quick brown fox");
    expect(all).not.toContain("Running Header");
    expect(all).not.toMatch(/(^| )[1-4]( |$)/);
    expect(r.title).toBe("Meta Title");
    expect(r.author).toBe("Meta Author");
    expect(r.chapterStarts.map((c) => c.title)).toEqual(["First part", "Third part"]);
    expect(r.chapterStarts[1].blockIndex).toBeGreaterThan(r.chapterStarts[0].blockIndex);
    expect(r.warnings.join(" ")).toMatch(/Removed/);
  });

  it("positive control: the same text WITHOUT the header keeps nothing extra removed", async () => {
    const r = await importPdf(makePdf([1, 2, 3, 4].map((n) => ({ lines: bodyPage(n, false) }))));
    expect(r.warnings.join(" ")).not.toMatch(/Removed/);
    expect(r.chapterStarts).toEqual([]);
  });

  it("no_text for a PDF with pages but no selectable text", async () => {
    await expect(importPdf(makePdf([{ lines: [] }, { lines: [] }]))).rejects.toMatchObject({ code: "no_text" });
  });

  it("parse_failed for garbage bytes", async () => {
    await expect(importPdf(new TextEncoder().encode("%PDF-1.4 not really a pdf"))).rejects.toBeInstanceOf(ReaderImportError);
  });
});
