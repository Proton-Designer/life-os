/**
 * PDF text extraction (A5 item 7a). Ported from ULM's apps/worker/src/pdf.ts
 * — unblocks the `chunking` stage handler, the first thing item 7 needs
 * that this repo genuinely didn't have before. `unpdf` chosen by ULM for
 * running across serverless/edge runtimes without native bindings, which is
 * exactly this repo's own Vercel constraint; zero transitive dependencies
 * (checked via `npm view unpdf dependencies` before installing, not
 * assumed) and 0 vulnerabilities on install.
 */
import { getDocumentProxy, extractText } from "unpdf";
import type { ExtractedPage, OutlineEntry } from "./types";
import { MAX_PAGE_COUNT } from "./guards";

export class EncryptedPdfError extends Error {
  constructor() {
    super("This PDF is password-protected.");
    this.name = "EncryptedPdfError";
  }
}

export class UnreadablePdfError extends Error {
  constructor(cause: unknown) {
    super("This PDF could not be read. It may be corrupted.");
    this.name = "UnreadablePdfError";
    this.cause = cause;
  }
}

export class TooManyPagesError extends Error {
  constructor(public readonly pageCount: number) {
    super(`This book has ${pageCount} pages, which is over the ${MAX_PAGE_COUNT}-page limit.`);
    this.name = "TooManyPagesError";
  }
}

// PDFDocumentProxy from pdf.js — unpdf re-exports the type but importing it
// directly pulls in the whole pdfjs type surface; `any` here is deliberate,
// narrow, and confined to this module's boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDocument = any;

export async function loadPdf(data: Uint8Array): Promise<PdfDocument> {
  try {
    return await getDocumentProxy(data);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new EncryptedPdfError();
    }
    throw new UnreadablePdfError(err);
  }
}

export async function extractPages(pdf: PdfDocument): Promise<ExtractedPage[]> {
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  if (totalPages > MAX_PAGE_COUNT) {
    throw new TooManyPagesError(totalPages);
  }
  return text.map((t, i) => ({ page: i + 1, text: t }));
}

/**
 * Priority 1 structure source (structure.ts's detectSectionsFromOutline).
 * Structure is a nice-to-have — any failure resolving the outline falls
 * back to heuristic detection, never blocks ingestion.
 */
export async function extractOutline(pdf: PdfDocument): Promise<OutlineEntry[]> {
  try {
    const raw = await pdf.getOutline();
    if (!raw || raw.length === 0) return [];

    const entries: OutlineEntry[] = [];

    const resolvePage = async (dest: unknown): Promise<number | null> => {
      try {
        const resolved = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!resolved || !Array.isArray(resolved)) return null;
        const pageIndex = await pdf.getPageIndex(resolved[0]);
        return typeof pageIndex === "number" ? pageIndex + 1 : null;
      } catch {
        return null;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = async (items: any[], level: number): Promise<void> => {
      for (const item of items) {
        const page = item.dest ? await resolvePage(item.dest) : null;
        if (typeof item.title === "string" && item.title.trim().length > 0) {
          entries.push({ title: item.title.trim(), page, level });
        }
        if (Array.isArray(item.items) && item.items.length > 0) {
          await walk(item.items, level + 1);
        }
      }
    };

    await walk(raw, 1);
    return entries;
  } catch {
    return [];
  }
}
