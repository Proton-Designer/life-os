import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Scanned (image-only) PDFs: detectScannedPdf existed but nothing called it, so a book with no text layer ran every
 * stage and failed hours later with "couldn't find teachable lessons". The chunking stage (the first stage with the
 * text) now stops it up front, with a message that says what is wrong and what to do.
 */

const extractPagesMock = vi.fn();
const loadPdfMock = vi.fn();
vi.mock("../pdf", async () => ({
  ...(await vi.importActual<typeof import("../pdf")>("../pdf")), // the real error classes the stage matches on
  loadPdf: (...a: unknown[]) => loadPdfMock(...a),
  extractPages: (...a: unknown[]) => extractPagesMock(...a),
  extractOutline: vi.fn(async () => []),
}));

// A scanned book: plenty of pages, but the text layer is empty or just a stray page number.
const scannedPages = () => Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: i % 5 === 0 ? String(i) : "" }));
// A normal book: ~2000 characters of prose per page.
const prose = "The mind forgets quickly unless the material is retrieved again after a delay. ".repeat(26);
const textPages = () => Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: prose }));

let storedFile: { path: string; bytes: Uint8Array } = { path: "u/b.pdf", bytes: new Uint8Array([1]) };

function makeSupabase() {
  const tablesTouched: string[] = [];
  const bookUpdates: Record<string, unknown>[] = [];
  const chain = (table: string, result: { data?: unknown; error: unknown } = { data: null, error: null }) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "insert", "delete", "eq", "in", "order", "returns"]) c[m] = vi.fn(() => c);
    c.update = vi.fn((vals: Record<string, unknown>) => {
      if (table === "books") bookUpdates.push(vals);
      return c;
    });
    c.single = vi.fn(async () => (table === "books" ? { data: { file_path: storedFile.path }, error: null } : result));
    c.then = (resolve: (v: unknown) => void) => resolve(result);
    return c;
  };
  return {
    tablesTouched,
    bookUpdates,
    supabase: {
      from: (table: string) => {
        tablesTouched.push(table);
        return chain(table);
      },
      storage: { from: () => ({ download: async () => ({ data: new Blob([storedFile.bytes as BlobPart]), error: null }) }) },
    },
  };
}

const ctxFor = (supabase: unknown) => ({ job: { id: "job-1", book_id: "book-1", user_id: "u1", cursor_chunk_index: null } as never, supabase: supabase as never });

describe("chunking stage: scanned-PDF guard", () => {
  beforeEach(() => {
    vi.resetModules();
    extractPagesMock.mockReset();
    loadPdfMock.mockReset().mockResolvedValue({});
    storedFile = { path: "u/b.pdf", bytes: new Uint8Array([1]) };
  });

  it("fails a scanned PDF immediately with a clear message, before writing any sections or chunks", async () => {
    extractPagesMock.mockResolvedValue(scannedPages());
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { supabase, tablesTouched, bookUpdates } = makeSupabase();

    const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));

    expect(result.nextStage).toBe("failed");
    expect(bookUpdates).toHaveLength(1);
    expect(bookUpdates[0]).toMatchObject({ status: "failed" });
    expect(String(bookUpdates[0]!.error_message)).toMatch(/scanned|no text/i);
    expect(tablesTouched).not.toContain("book_sections");
    expect(tablesTouched).not.toContain("source_chunks");
  });

  it("does not trip on a normal text-layer PDF: it carries on to write sections and chunks", async () => {
    extractPagesMock.mockResolvedValue(textPages());
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { supabase, tablesTouched, bookUpdates } = makeSupabase();

    const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));

    expect(result.nextStage).not.toBe("failed");
    expect(bookUpdates.filter((u) => u.status === "failed")).toHaveLength(0);
    expect(tablesTouched).toContain("source_chunks");
  });

  describe("a problem with the file itself fails the book on the first attempt with a specific message", () => {
    const cases: [string, (pdf: typeof import("../pdf")) => Error, RegExp][] = [
      ["a password-protected PDF", (pdf) => new pdf.EncryptedPdfError(), /password/i],
      ["a damaged PDF", (pdf) => new pdf.UnreadablePdfError(new Error("bad xref")), /couldn't read this PDF/i],
      ["a PDF over the page limit", (pdf) => new pdf.TooManyPagesError(2400), /2400 pages.*1500-page limit/],
    ];
    it.each(cases)("%s", async (_name, makeError, message) => {
      const pdf = await import("../pdf");
      loadPdfMock.mockRejectedValue(makeError(pdf));
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, tablesTouched, bookUpdates } = makeSupabase();

      const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));

      expect(result.nextStage).toBe("failed");
      expect(bookUpdates).toHaveLength(1);
      expect(bookUpdates[0]).toMatchObject({ status: "failed" });
      expect(String(bookUpdates[0]!.error_message)).toMatch(message);
      expect(tablesTouched).not.toContain("book_sections");
    });

    it("an unrelated error is still thrown (so the route's retry/fail handling sees it), not swallowed as a file problem", async () => {
      loadPdfMock.mockRejectedValue(new Error("network blip"));
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, bookUpdates } = makeSupabase();

      await expect(STAGE_HANDLERS.chunking!(ctxFor(supabase))).rejects.toThrow("network blip");
      expect(bookUpdates).toHaveLength(0);
    });
  });

  it("isRetryableBookError: the text-format file problems are not retryable either", async () => {
    const { isRetryableBookError, EMPTY_DOCUMENT_MESSAGE, NOT_TEXT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE } = await import("../failure-messages");
    for (const m of [EMPTY_DOCUMENT_MESSAGE, NOT_TEXT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE]) {
      expect(typeof m).toBe("string");
      expect(isRetryableBookError(m)).toBe(false);
    }
  });

  it("isRetryableBookError: file problems are not retryable, everything else is", async () => {
    const { isRetryableBookError, SCANNED_PDF_MESSAGE, ENCRYPTED_PDF_MESSAGE, UNREADABLE_PDF_MESSAGE, tooManyPagesMessage, NO_KEY_MESSAGE, MONTHLY_CAP_MESSAGE } = await import("../failure-messages");
    // An AI block is about the account, not the file: a key can be added or a month can pass, so Try again stays offered.
    for (const m of [NO_KEY_MESSAGE, MONTHLY_CAP_MESSAGE]) {
      expect(typeof m).toBe("string"); // isRetryableBookError(undefined) is true too, so prove the message exists first
      expect(isRetryableBookError(m)).toBe(true);
    }
    for (const m of [SCANNED_PDF_MESSAGE, ENCRYPTED_PDF_MESSAGE, UNREADABLE_PDF_MESSAGE, tooManyPagesMessage(2000, 1500)]) expect(isRetryableBookError(m)).toBe(false);
    expect(isRetryableBookError("Something went wrong while processing this book. Please try uploading it again.")).toBe(true);
    expect(isRetryableBookError("The AI provider kept timing out while processing this book. Please try again later.")).toBe(true);
    expect(isRetryableBookError(null)).toBe(true);
  });

  describe("EPUB / TXT / Markdown (lesson ingestion beyond PDF)", () => {
    const prose = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} explains how spaced retrieval strengthens a memory far more than rereading ever does. `.repeat(6).trim()).join("\n\n");

    it("a TXT book is chunked from its own text: no PDF parsing, sections + chunks written, page_count set from the synthetic pages", async () => {
      storedFile = { path: "u/b.txt", bytes: new TextEncoder().encode(`CHAPTER I\n\n${prose}\n\nCHAPTER II\n\n${prose}`) };
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, tablesTouched, bookUpdates } = makeSupabase();

      const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));

      expect(result.nextStage).toBe("embedding");
      expect(loadPdfMock).not.toHaveBeenCalled();
      expect(tablesTouched).toEqual(expect.arrayContaining(["book_sections", "source_chunks"]));
      expect(bookUpdates.some((u) => typeof u.page_count === "number" && (u.page_count as number) > 1)).toBe(true);
      expect(bookUpdates.filter((u) => u.status === "failed")).toHaveLength(0);
    });

    it("an empty / blank text file fails the book at once with a clear message, nothing written", async () => {
      storedFile = { path: "u/b.md", bytes: new TextEncoder().encode("   \n\n  ") };
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, tablesTouched, bookUpdates } = makeSupabase();

      const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));

      expect(result.nextStage).toBe("failed");
      expect(String(bookUpdates[0]!.error_message)).toMatch(/readable text/i);
      expect(tablesTouched).not.toContain("source_chunks");
    });

    it("a broken EPUB fails with the 'couldn't read' message, a binary renamed .txt with the 'isn't readable text' one", async () => {
      const { STAGE_HANDLERS } = await import("../worker-stages");

      storedFile = { path: "u/b.epub", bytes: new TextEncoder().encode("this is not a zip file at all") };
      const epub = makeSupabase();
      expect((await STAGE_HANDLERS.chunking!(ctxFor(epub.supabase))).nextStage).toBe("failed");
      expect(String(epub.bookUpdates[0]!.error_message)).toMatch(/couldn't read/i);

      const png = new Uint8Array(4000).map((_, i) => (i * 7) % 256);
      png[0] = 0x89;
      storedFile = { path: "u/b.txt", bytes: png };
      const bin = makeSupabase();
      expect((await STAGE_HANDLERS.chunking!(ctxFor(bin.supabase))).nextStage).toBe("failed");
      expect(String(bin.bookUpdates[0]!.error_message)).toMatch(/isn't readable text/i);
    });

    it("a text longer than the page ceiling fails with the same too-many-pages message PDFs get", async () => {
      const huge = Array.from({ length: 6000 }, (_, i) => `Paragraph ${i} explains how spaced retrieval strengthens a memory far more than rereading ever does. `.repeat(6).trim()).join("\n\n");
      storedFile = { path: "u/b.txt", bytes: new TextEncoder().encode(huge) };
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, bookUpdates, tablesTouched } = makeSupabase();
      expect((await STAGE_HANDLERS.chunking!(ctxFor(supabase))).nextStage).toBe("failed");
      expect(String(bookUpdates[0]!.error_message)).toMatch(/pages, which is over the 1500-page limit/);
      expect(tablesTouched).not.toContain("source_chunks");
    });

    it("the scanned-PDF guard does not apply to text formats (a short but real text file is not 'scanned')", async () => {
      storedFile = { path: "u/b.txt", bytes: new TextEncoder().encode(`${prose.slice(0, 700)}`) };
      const { STAGE_HANDLERS } = await import("../worker-stages");
      const { supabase, bookUpdates } = makeSupabase();
      const result = await STAGE_HANDLERS.chunking!(ctxFor(supabase));
      expect(result.nextStage).toBe("embedding");
      expect(bookUpdates.filter((u) => u.status === "failed")).toHaveLength(0);
    });
  });
});
