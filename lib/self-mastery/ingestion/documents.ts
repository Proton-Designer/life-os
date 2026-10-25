import { ReaderImportError } from "@/lib/reader/import/errors";
import { decodeText } from "@/lib/reader/import";
import { importEpub } from "@/lib/reader/import/epub";
import { markdownToBlocks, textToBlocks, type RawBlock } from "@/lib/reader/import/cleanup";
import { MAX_PAGE_COUNT } from "./guards";
import type { ExtractedPage, OutlineEntry } from "./types";

/**
 * Lesson ingestion for EPUB / TXT / Markdown (PDF keeps its own path in pdf.ts). Everything downstream of text extraction
 * (structure.ts, chunk.ts, the section and chunk inserts) speaks in numbered PAGES and a page-based OUTLINE, so rather than
 * teach it a second shape this file turns a reflowable document into the same two things:
 *
 *   pages    ~SYNTHETIC_PAGE_CHARS of text each, numbered from 1. They are only an internal coordinate for chunking and for
 *            spreading lessons across the book. They are NOT shown to anyone: lessons from these sources store page_ref
 *            NULL (see isPagedSource) and cite their section instead.
 *   outline  the chapter / heading starts. Every chapter starts on a page of its own, so no two sections share a page.
 *
 * SYNTHETIC_PAGE_CHARS is about the size of a real PDF page of prose (the live runs measured ~1,700 chars), so the
 * page-count-based lesson target (pages / 8, structure.ts' caller) comes out the same for a book however it was uploaded.
 *
 * Reuses the focus reader's importers (lib/reader/import) for the format work: the EPUB spine / OPF / nav, paragraph and
 * heading detection, de-hyphenation. Failures are ReaderImportError with a code the chunking stage turns into a book message.
 */
export const SYNTHETIC_PAGE_CHARS = 1800;

/** A ReaderImportError("too_large") that also says how long the text was, so the book can say "N pages, over the limit". */
export class TooManyPagesDocumentError extends ReaderImportError {
  constructor(public readonly pageCount: number) {
    super("too_large", `This text is ${pageCount} pages long, which is over the ${MAX_PAGE_COUNT}-page limit.`);
  }
}
const MIN_TEXT_CHARS = 200;

export type LessonSourceKind = "pdf" | "epub" | "txt" | "md";

/** The kind a stored file is, by its extension. null = not a format lesson ingestion accepts. */
export function lessonSourceKind(filePath: string | null | undefined): LessonSourceKind | null {
  const ext = (filePath ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  if (ext === "txt" || ext === "text") return "txt";
  if (ext === "md" || ext === "markdown" || ext === "mdown") return "md";
  return null;
}

/** books.reader_source -> does this book have real page numbers? Only PDFs do. A row from before the column was set is a PDF. */
export function isPagedSource(readerSource: string | null | undefined): boolean {
  return readerSource === null || readerSource === undefined || readerSource === "pdf";
}

/** A text file with NUL bytes or a high share of control characters is a binary file wearing a .txt name. */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let control = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

interface Blocked {
  blocks: RawBlock[];
  chapterStarts: { title: string; blockIndex: number }[];
}

function toBlocks(bytes: Uint8Array, kind: "epub" | "txt" | "md"): Blocked {
  if (kind === "epub") {
    const r = importEpub(bytes);
    return { blocks: r.blocks, chapterStarts: r.chapterStarts };
  }
  if (looksBinary(bytes)) throw new ReaderImportError("unsupported_type", "That file doesn't look like text.");
  const text = decodeText(bytes);
  if (kind === "md") {
    const { blocks, headingLevels } = markdownToBlocks(text);
    const levels = headingLevels.filter((l) => l > 0);
    const maxLevel = levels.length && levels.some((l) => l <= 2) ? 2 : 6;
    const chapterStarts = blocks
      .map((b, i) => ({ b, i, l: headingLevels[i] ?? 0 }))
      .filter(({ b, l }) => b.kind === "h" && l <= maxLevel)
      .map(({ b, i }) => ({ title: b.text, blockIndex: i }));
    return { blocks, chapterStarts };
  }
  const blocks = textToBlocks(text);
  return { blocks, chapterStarts: blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === "h").map(({ b, i }) => ({ title: b.text, blockIndex: i })) };
}

export function extractTextDocument(bytes: Uint8Array, kind: "epub" | "txt" | "md"): { pages: ExtractedPage[]; outline: OutlineEntry[] } {
  const { blocks, chapterStarts } = toBlocks(bytes, kind);
  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (blocks.length === 0 || totalChars < MIN_TEXT_CHARS) throw new ReaderImportError("empty", "There's no readable text in that file.");

  const startAt = new Map<number, string>();
  for (const c of chapterStarts) if (!startAt.has(c.blockIndex)) startAt.set(c.blockIndex, c.title);

  const pages: ExtractedPage[] = [];
  const outline: OutlineEntry[] = [];
  let current = "";
  const flush = () => {
    if (current.trim().length > 0) pages.push({ page: pages.length + 1, text: current });
    current = "";
  };
  blocks.forEach((block, i) => {
    const chapterTitle = startAt.get(i);
    if (current && (chapterTitle !== undefined || current.length + block.text.length + 2 > SYNTHETIC_PAGE_CHARS)) flush();
    if (chapterTitle !== undefined) outline.push({ title: chapterTitle, page: pages.length + 1, level: 1 });
    current += (current ? "\n\n" : "") + block.text;
  });
  flush();
  // The same ceiling a PDF has, in the same unit: an unbounded text is an unbounded LLM bill.
  if (pages.length > MAX_PAGE_COUNT) throw new TooManyPagesDocumentError(pages.length);
  return { pages, outline };
}
