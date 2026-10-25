import { describe, it, expect } from "vitest";
import { strToU8 } from "fflate";
import { makeEpub } from "@/lib/reader/import/__tests__/helpers";
import { extractTextDocument, lessonSourceKind, isPagedSource, SYNTHETIC_PAGE_CHARS } from "../documents";
import { detectSectionsFromOutline } from "../structure";
import { chunkBook } from "../chunk";

const para = (n: number) => `This is sentence ${n} about how retrieval practice strengthens memory over time. `.repeat(8).trim();
const prose = (paragraphs: number, offset = 0) => Array.from({ length: paragraphs }, (_, i) => para(offset + i)).join("\n\n");

describe("lessonSourceKind", () => {
  it("maps stored file paths to a kind by extension, null for anything else", () => {
    expect(lessonSourceKind("u/b.pdf")).toBe("pdf");
    expect(lessonSourceKind("u/b.EPUB")).toBe("epub");
    expect(lessonSourceKind("u/b.txt")).toBe("txt");
    expect(lessonSourceKind("u/b.md")).toBe("md");
    expect(lessonSourceKind("u/b.markdown")).toBe("md");
    expect(lessonSourceKind("u/b.docx")).toBeNull();
    expect(lessonSourceKind(null)).toBeNull();
  });
  it("only PDFs (and rows from before the column existed) have real page numbers", () => {
    expect(isPagedSource("pdf")).toBe(true);
    expect(isPagedSource(null)).toBe(true);
    expect(isPagedSource("epub")).toBe(false);
    expect(isPagedSource("text")).toBe(false);
  });
});

describe("extractTextDocument", () => {
  it("TXT: numbers synthetic pages from 1, each about SYNTHETIC_PAGE_CHARS long, with no text lost", () => {
    const text = prose(60);
    const { pages } = extractTextDocument(strToU8(text), "txt");
    expect(pages[0]!.page).toBe(1);
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages.slice(0, -1)) expect(p.text.length).toBeLessThan(SYNTHETIC_PAGE_CHARS * 2.5);
    const joined = pages.map((p) => p.text).join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("sentence 0 about how retrieval practice");
    expect(joined).toContain("sentence 59 about how retrieval practice");
  });

  it("MD: headings become outline entries, each chapter starts on its own page, and the existing section/chunk code accepts the result", () => {
    const md = `# Book\n\n## Chapter One\n\n${prose(10)}\n\n## Chapter Two\n\n${prose(10, 100)}\n\n## Chapter Three\n\n${prose(10, 200)}\n`;
    const { pages, outline } = extractTextDocument(strToU8(md), "md");
    const titles = outline.map((o) => o.title);
    expect(titles).toEqual(expect.arrayContaining(["Chapter One", "Chapter Two", "Chapter Three"]));
    const pagesOfOutline = outline.map((o) => o.page);
    expect(new Set(pagesOfOutline).size).toBe(pagesOfOutline.length); // no two chapters share a page
    const sections = detectSectionsFromOutline(outline, pages);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const chunks = chunkBook(pages, sections);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.pageStart >= 1 && c.pageEnd >= c.pageStart)).toBe(true);
  });

  it("TXT with chapter-style headings still finds sections", () => {
    const text = `CHAPTER I\n\n${prose(8)}\n\nCHAPTER II\n\n${prose(8, 50)}\n`;
    const { outline } = extractTextDocument(strToU8(text), "txt");
    expect(outline.length).toBeGreaterThanOrEqual(2);
  });

  it("EPUB: chapters from the table of contents become outline entries; text comes through", () => {
    const epub = makeEpub({
      chapters: [
        { file: "c1.xhtml", tocTitle: "The First Idea", html: `<html><body><h1>The First Idea</h1>${prose(6).split("\n\n").map((p) => `<p>${p}</p>`).join("")}</body></html>` },
        { file: "c2.xhtml", tocTitle: "The Second Idea", html: `<html><body><h1>The Second Idea</h1>${prose(6, 40).split("\n\n").map((p) => `<p>${p}</p>`).join("")}</body></html>` },
      ],
    });
    const { pages, outline } = extractTextDocument(epub, "epub");
    expect(outline.map((o) => o.title)).toEqual(["The First Idea", "The Second Idea"]);
    expect(pages.map((p) => p.text).join(" ")).toContain("sentence 40 about how retrieval practice");
  });

  it("refuses a file with no readable text, with a typed error", () => {
    expect(() => extractTextDocument(strToU8("   \n\n  "), "txt")).toThrowError(expect.objectContaining({ code: "empty" }));
    expect(() => extractTextDocument(strToU8("short"), "md")).toThrowError(expect.objectContaining({ code: "empty" }));
  });

  it("refuses a text longer than the same 1,500-page ceiling PDFs have (measured in synthetic pages), with a typed too_large error carrying the count", () => {
    const huge = prose(5000);
    try {
      extractTextDocument(strToU8(huge), "txt");
      throw new Error("expected too_large");
    } catch (e) {
      expect(e).toMatchObject({ code: "too_large", pageCount: expect.any(Number) });
      expect((e as { pageCount: number }).pageCount).toBeGreaterThan(1500);
    }
  });

  it("refuses an EPUB that is not a valid EPUB, and a renamed binary posing as .txt", () => {
    expect(() => extractTextDocument(strToU8("not a zip"), "epub")).toThrowError(expect.objectContaining({ code: "parse_failed" }));
    const binary = new Uint8Array(4000).map((_, i) => (i * 7) % 256);
    binary[0] = 0x89; binary[1] = 0x50; binary[2] = 0x4e; binary[3] = 0x47; // PNG magic
    expect(() => extractTextDocument(binary, "txt")).toThrowError(expect.objectContaining({ code: "unsupported_type" }));
  });
});
