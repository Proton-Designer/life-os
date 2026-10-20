import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * BRIEF-pdf-gc.md, definition of done: "the control that matters: prove a
 * mid-ingestion retry can still find the file. A test that only shows
 * deletion happening at the end does not show it *doesn't* happen early."
 *
 * Two things are proven here, deliberately kept in one file:
 *  1. `finalizingStage`'s READY branch (and only that branch) triggers the
 *     GC call, with the failed/no-lessons branch calling it not at all.
 *  2. `chunkingStage` -- the exact stage BRIEF-pdf-gc.md names as re-parsing
 *     the PDF "from scratch on retry" -- can still download the SAME file
 *     on a second, fully independent invocation (a retry) against a
 *     stateful fake Storage bucket that only "loses" a file when something
 *     actually calls `.remove()` on it. Nothing in chunkingStage's own code
 *     path ever does that; this test would fail loudly if it ever did.
 */

vi.mock("@/lib/notifications/book-ready-notification", () => ({
  notifyBookReady: vi.fn(async () => {}),
}));

const gcMock = vi.fn(async (_supabase: unknown, _target: { bookId: string; userId: string; filePath: string }) => {});
vi.mock("../book-pdf-gc", () => ({
  gcBookPdfAfterIngestion: (supabase: unknown, target: { bookId: string; userId: string; filePath: string }) => gcMock(supabase, target),
}));

const readerBuildMock = vi.fn(async (_s: unknown, _u: string, _b: string) => {});
vi.mock("@/lib/reader/server/best-effort", () => ({
  buildReaderDocBeforeGc: (s: unknown, u: string, b: string) => readerBuildMock(s, u, b),
}));

vi.mock("../pdf", () => ({
  loadPdf: vi.fn(async () => ({})),
  extractPages: vi.fn(async () => [{ page: 1, text: "Chapter One. This is a short sample page of book text for the chunker to work with. ".repeat(6) }]),
  extractOutline: vi.fn(async () => []),
}));

function makeFinalizingSupabase(opts: { activeLessonCount: number; filePath: string | null }) {
  return {
    from(table: string) {
      if (table === "lessons") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ count: opts.activeLessonCount, error: null }),
            }),
          }),
        };
      }
      if (table === "books") {
        return {
          update: (_vals: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { file_path: opts.filePath }, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("finalizingStage — book PDF GC call site", () => {
  beforeEach(() => {
    gcMock.mockClear();
    readerBuildMock.mockReset().mockResolvedValue(undefined);
  });

  it("reader: builds the reader document BEFORE the PDF is deleted", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const order: string[] = [];
    readerBuildMock.mockImplementation(async () => void order.push("reader"));
    gcMock.mockImplementationOnce(async () => void order.push("gc"));
    const supabase = makeFinalizingSupabase({ activeLessonCount: 5, filePath: "user-1/book-1.pdf" });
    await STAGE_HANDLERS.finalizing!({ job: { id: "j", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never, supabase: supabase as never });
    expect(readerBuildMock).toHaveBeenCalledExactlyOnceWith(supabase, "user-1", "book-1");
    expect(order).toEqual(["reader", "gc"]);
  });

  it("reader build THROWING still lets ingestion finish: stage is done and the PDF is still collected", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    readerBuildMock.mockRejectedValue(new Error("boom"));
    const supabase = makeFinalizingSupabase({ activeLessonCount: 5, filePath: "user-1/book-1.pdf" });
    const result = await STAGE_HANDLERS.finalizing!({ job: { id: "j", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never, supabase: supabase as never });
    expect(result.nextStage).toBe("done");
    expect(gcMock).toHaveBeenCalledTimes(1);
  });

  it("no reader build on the failed path or when the PDF is already gone", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    await STAGE_HANDLERS.finalizing!({ job: { id: "j", book_id: "b", user_id: "u", cursor_chunk_index: null } as never, supabase: makeFinalizingSupabase({ activeLessonCount: 0, filePath: "x.pdf" }) as never });
    await STAGE_HANDLERS.finalizing!({ job: { id: "j", book_id: "b", user_id: "u", cursor_chunk_index: null } as never, supabase: makeFinalizingSupabase({ activeLessonCount: 5, filePath: null }) as never });
    expect(readerBuildMock).not.toHaveBeenCalled();
  });

  it("ready path: calls gcBookPdfAfterIngestion with the book/user/file_path, once", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeFinalizingSupabase({ activeLessonCount: 5, filePath: "user-1/book-1.pdf" });

    const result = await STAGE_HANDLERS.finalizing!({
      job: { id: "job-1", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never,
      supabase: supabase as never,
    });

    expect(result.nextStage).toBe("done");
    expect(gcMock).toHaveBeenCalledExactlyOnceWith(supabase, {
      bookId: "book-1",
      userId: "user-1",
      filePath: "user-1/book-1.pdf",
    });
  });

  it("failed (zero teachable lessons) path: never calls GC -- this is not a success state", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeFinalizingSupabase({ activeLessonCount: 0, filePath: "user-1/book-1.pdf" });

    const result = await STAGE_HANDLERS.finalizing!({
      job: { id: "job-1", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never,
      supabase: supabase as never,
    });

    expect(result.nextStage).toBe("failed");
    expect(gcMock).not.toHaveBeenCalled();
  });

  it("a retried finalizing pass (file_path already null from a prior GC) skips calling GC again", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeFinalizingSupabase({ activeLessonCount: 5, filePath: null });

    await STAGE_HANDLERS.finalizing!({
      job: { id: "job-1", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never,
      supabase: supabase as never,
    });

    expect(gcMock).not.toHaveBeenCalled();
  });
});

/**
 * Stateful fake Storage: a file is "gone" only once something calls
 * `.remove()` on it, exactly like a real bucket. `gcBookPdfAfterIngestion`
 * is mocked above and never wired into this stage at all, so its own
 * `.remove()` calls (tested separately in book-pdf-gc.test.ts) can't fire
 * here -- this test's whole point is showing NOTHING ELSE in chunkingStage's
 * own code path removes the object either.
 */
function makeChunkingSupabase(filePath: string) {
  const bucket = new Map<string, ArrayBuffer>([[filePath, new TextEncoder().encode("pretend-pdf-bytes").buffer]]);
  const removeCalls: string[][] = [];

  return {
    supabase: {
      storage: {
        from: (_bucket: string) => ({
          download: async (path: string) => {
            const bytes = bucket.get(path);
            if (!bytes) return { data: null, error: new Error(`object not found: ${path}`) };
            return { data: { arrayBuffer: async () => bytes }, error: null };
          },
          remove: async (paths: string[]) => {
            removeCalls.push(paths);
            for (const p of paths) bucket.delete(p);
            return { error: null };
          },
        }),
      },
      from(table: string) {
        if (table === "books") {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { file_path: filePath }, error: null }) }) }),
            update: (_vals: Record<string, unknown>) => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "book_sections" || table === "source_chunks") {
          return {
            delete: () => ({ eq: async () => ({ error: null }) }),
            insert: async () => ({ error: null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
    removeCalls,
    bucket,
  };
}

describe("chunkingStage — the retry BRIEF-pdf-gc.md names by line number", () => {
  it("a second, independent invocation (a retry) can still download the same file -- nothing in this stage's own path ever removes it", async () => {
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const filePath = "user-1/book-1.pdf";
    const { supabase, removeCalls, bucket } = makeChunkingSupabase(filePath);
    const job = { id: "job-1", book_id: "book-1", user_id: "user-1", cursor_chunk_index: null } as never;

    const first = await STAGE_HANDLERS.chunking!({ job, supabase: supabase as never });
    expect(first.nextStage).toBe("embedding");
    expect(bucket.has(filePath)).toBe(true); // still there after a genuine success

    // Simulate a retry: re-invoke the exact same handler again, as the route
    // would if the process crashed before the stage transition was durably
    // persisted (worker-stages.ts's own documented idempotent-retry design).
    const second = await STAGE_HANDLERS.chunking!({ job, supabase: supabase as never });
    expect(second.nextStage).toBe("embedding");

    expect(removeCalls).toHaveLength(0); // chunkingStage itself never deletes anything
  });
});
