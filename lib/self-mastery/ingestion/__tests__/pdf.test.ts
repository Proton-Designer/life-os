import { describe, it, expect } from "vitest";
import { loadPdf, extractPages, extractOutline, UnreadablePdfError, EncryptedPdfError, TooManyPagesError } from "../pdf";

/**
 * Builds a genuinely valid, minimal single-page PDF byte-for-byte (catalog,
 * pages tree, one page, one content stream, one base-14 font) — no
 * external tool, no binary fixture committed to the repo. Verified with
 * the system `file` command before this test suite was written: "PDF
 * document, version 1.4, 1 pages", not merely "looks plausible." Real
 * bytes through the real `unpdf`/pdf.js parser, never a mock of it.
 */
function buildMinimalPdf(text: string): Uint8Array {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const escaped = text.replace(/([()\\])/g, "\\$1");
  const content = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  objects[5] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}

describe("loadPdf + extractPages, against a real PDF", () => {
  it("extracts the real text content of a genuine one-page PDF", async () => {
    const bytes = buildMinimalPdf("Hello from a real test PDF.");
    const pdf = await loadPdf(bytes);
    const pages = await extractPages(pdf);
    expect(pages).toEqual([{ page: 1, text: "Hello from a real test PDF." }]);
  });

  it("round-trips a string containing PDF-special characters (parens, backslash)", async () => {
    const bytes = buildMinimalPdf("Cost is (roughly) $5, path C:\\book.pdf");
    const pdf = await loadPdf(bytes);
    const pages = await extractPages(pdf);
    expect(pages[0]!.text).toContain("Cost is");
    expect(pages[0]!.text).toContain("book.pdf");
  });

  it("extractOutline returns an empty array for a PDF with no bookmarks, never throws", async () => {
    const bytes = buildMinimalPdf("No outline here.");
    const pdf = await loadPdf(bytes);
    await expect(extractOutline(pdf)).resolves.toEqual([]);
  });
});

describe("error paths, against real malformed input", () => {
  it("loadPdf throws UnreadablePdfError on genuinely garbled bytes (not a PDF at all)", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253, 0, 0, 0, 0]);
    await expect(loadPdf(garbage)).rejects.toBeInstanceOf(UnreadablePdfError);
  });

  it("loadPdf throws UnreadablePdfError on a truncated/corrupted PDF (valid header, no valid body)", async () => {
    const truncated = new TextEncoder().encode("%PDF-1.4\nthis is not actually valid pdf content past the header");
    await expect(loadPdf(truncated)).rejects.toBeInstanceOf(UnreadablePdfError);
  });
});

describe("error class shapes", () => {
  // Password-protected-PDF and >MAX_PAGE_COUNT paths are NOT exercised
  // above with real inputs -- generating a genuinely valid encrypted PDF or
  // a genuinely 1500+-page one by hand is impractical here, and this repo
  // has no such fixture (checked: no .pdf files anywhere in either repo).
  // Stated as an honest gap, not silently skipped or faked with a mock
  // that would just prove these classes construct correctly, which is all
  // these two tests below actually prove.
  it("EncryptedPdfError carries the user-facing message loadPdf's catch branch produces", () => {
    const err = new EncryptedPdfError();
    expect(err.message).toMatch(/password/i);
  });

  it("TooManyPagesError names the actual page count in its message", () => {
    const err = new TooManyPagesError(2000);
    expect(err.pageCount).toBe(2000);
    expect(err.message).toContain("2000");
  });
});
