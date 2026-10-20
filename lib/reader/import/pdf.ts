import { loadPdf, extractPages, extractOutline, EncryptedPdfError, UnreadablePdfError, TooManyPagesError } from "@/lib/self-mastery/ingestion/pdf";
import { flattenLines, normalizeLines, stripPageFurniture, type RawBlock } from "./cleanup";
import { ReaderImportError } from "./errors";

export interface PdfResult {
  title: string | null;
  author: string | null;
  blocks: RawBlock[];
  chapterStarts: { title: string; blockIndex: number }[];
  warnings: string[];
}

const MIN_CHARS_PER_PAGE = 20;

export async function importPdf(bytes: Uint8Array): Promise<PdfResult> {
  let pdf;
  try {
    // pdf.js transfers the buffer; hand it a copy so the caller's bytes stay usable.
    pdf = await loadPdf(new Uint8Array(bytes));
  } catch (err) {
    if (err instanceof EncryptedPdfError) throw new ReaderImportError("encrypted_pdf");
    if (err instanceof UnreadablePdfError) throw new ReaderImportError("parse_failed", undefined, { cause: err });
    throw new ReaderImportError("parse_failed", undefined, { cause: err });
  }

  let pages;
  try {
    pages = await extractPages(pdf);
  } catch (err) {
    if (err instanceof TooManyPagesError) throw new ReaderImportError("too_large", err.message);
    throw new ReaderImportError("parse_failed", undefined, { cause: err });
  }

  const totalChars = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  if (pages.length === 0 || totalChars < MIN_CHARS_PER_PAGE * Math.min(pages.length, 5)) throw new ReaderImportError("no_text");

  const warnings: string[] = [];
  const emptyPages = pages.filter((p) => p.text.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE).length;
  if (emptyPages > Math.max(2, pages.length * 0.2)) {
    warnings.push(`${emptyPages} of ${pages.length} pages had no selectable text and were skipped (scanned pages need OCR).`);
  }

  const lined = pages.map((p) => normalizeLines(p.text).split("\n"));
  const { pages: stripped, removed } = stripPageFurniture(lined);
  if (removed > 0) warnings.push(`Removed ${removed} running header/footer/page-number lines.`);
  const { blocks, pageStartBlock } = flattenLines(stripped);

  let title: string | null = null;
  let author: string | null = null;
  try {
    const meta = await pdf.getMetadata();
    const t = typeof meta?.info?.Title === "string" ? meta.info.Title.trim() : "";
    const a = typeof meta?.info?.Author === "string" ? meta.info.Author.trim() : "";
    title = t || null;
    author = a || null;
  } catch {
    /* metadata is optional */
  }

  const chapterStarts: PdfResult["chapterStarts"] = [];
  const outline = await extractOutline(pdf);
  const withPage = outline.filter((o) => o.page !== null);
  const level1 = withPage.filter((o) => o.level === 1);
  const useEntries = withPage.length > 200 ? level1 : withPage.filter((o) => o.level <= 2);
  for (const o of useEntries) {
    const start = pageStartBlock[(o.page as number) - 1];
    if (start !== undefined && blocks.length > 0) chapterStarts.push({ title: o.title, blockIndex: Math.min(start, blocks.length - 1) });
  }
  return { title, author, blocks, chapterStarts, warnings };
}
