import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Scanned (image-only) PDFs: detectScannedPdf existed but nothing called it, so a book with no text layer ran every
 * stage and failed hours later with "couldn't find teachable lessons". The chunking stage (the first stage with the
 * text) now stops it up front, with a message that says what is wrong and what to do.
 */

const extractPagesMock = vi.fn();
vi.mock("../pdf", () => ({
  loadPdf: vi.fn(async () => ({})),
  extractPages: (...a: unknown[]) => extractPagesMock(...a),
  extractOutline: vi.fn(async () => []),
}));

// A scanned book: plenty of pages, but the text layer is empty or just a stray page number.
const scannedPages = () => Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: i % 5 === 0 ? String(i) : "" }));
// A normal book: ~2000 characters of prose per page.
const prose = "The mind forgets quickly unless the material is retrieved again after a delay. ".repeat(26);
const textPages = () => Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: prose }));

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
    c.single = vi.fn(async () => (table === "books" ? { data: { file_path: "u/b.pdf" }, error: null } : result));
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
      storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1])]), error: null }) }) },
    },
  };
}

const ctxFor = (supabase: unknown) => ({ job: { id: "job-1", book_id: "book-1", user_id: "u1", cursor_chunk_index: null } as never, supabase: supabase as never });

describe("chunking stage: scanned-PDF guard", () => {
  beforeEach(() => {
    vi.resetModules();
    extractPagesMock.mockReset();
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
});
