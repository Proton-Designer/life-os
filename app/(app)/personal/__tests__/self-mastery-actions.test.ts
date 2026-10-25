import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * URGENT pdf-upload fix (2026-09-19, BRIEF-pdf-upload.md): `uploadBook`
 * used to accept the PDF as part of its own FormData request body, which
 * Next 16.3.5 caps at 1MB by default -- every real book crashed before
 * this file ever ran. Replaced with a three-hop direct-to-Storage flow
 * (prepareBookUpload -> browser uploads straight to Storage ->
 * finalizeBookUpload), same shape as school/lecture-actions.ts's
 * prepareLectureUpload/finalizeLectureUpload. `uploadBook` no longer
 * exists; the pre-upload gates it used to run (driver-down, no usable key,
 * no title) now run in prepareBookUpload, still before `books` is ever
 * touched.
 */

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const isIngestionAvailableMock = vi.fn();
vi.mock("@/lib/self-mastery/ingestion-availability", () => ({
  isIngestionAvailable: () => isIngestionAvailableMock(),
  INGESTION_UNAVAILABLE_MESSAGE: "driver down message",
}));

const hasAgentConnectorMock = vi.fn();
vi.mock("@/lib/agent-jobs/core", () => ({ hasAgentConnector: (...a: unknown[]) => hasAgentConnectorMock(...a) }));
const hasUsableIngestionKeyMock = vi.fn();
vi.mock("@/lib/ai/gateway", () => ({
  hasUsableIngestionKey: (...args: unknown[]) => hasUsableIngestionKeyMock(...args),
  ingestionNoKeyMessage: (providerLabel: string | undefined) =>
    providerLabel ? `Add an API key for ${providerLabel} in Settings to process books.` : "Add an AI provider key in Settings to process books.",
}));

// Same "thenable chain" shape as lecture-actions.test.ts's own fake.
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "single", "maybeSingle", "returns"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(result);
  return chain;
}

let fromResults: Record<string, { data: unknown; error: unknown }> = {};
const fromMock = vi.fn((table: string) => makeChain(fromResults[table] ?? { data: null, error: null }));

const createSignedUploadUrlMock = vi.fn(async (_path: string) => ({
  data: { path: "unused", token: "upload-token-abc" } as { path: string; token: string } | null,
  error: null as { message: string } | null,
}));
const listMock = vi.fn(
  async (_dir: string, _opts: { search: string }) =>
    ({ data: [] as { name: string; metadata: Record<string, unknown> | null }[], error: null as { message: string } | null })
);
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const createSignedUrlMock = vi.fn(async (_path: string, _ttl?: number) => ({ data: null as { signedUrl: string } | null, error: { message: "no signed url in this test" } as { message: string } | null }));

const rpcMock = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: "retried" as unknown, error: null as { message: string } | null }));
const requireUserMock = vi.fn(async () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    storage: {
      from: () => ({
        createSignedUploadUrl: createSignedUploadUrlMock,
        createSignedUrl: createSignedUrlMock,
        list: listMock,
        remove: removeMock,
      }),
    },
  },
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("self-mastery-actions -- direct-to-storage book upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromResults = { books: { data: { id: "book-1" }, error: null } };
    isIngestionAvailableMock.mockResolvedValue(true);
    hasUsableIngestionKeyMock.mockResolvedValue({ usable: true, providerLabel: "DeepSeek" });
    hasAgentConnectorMock.mockReset().mockResolvedValue(false);
    createSignedUploadUrlMock.mockResolvedValue({ data: { path: "unused", token: "upload-token-abc" }, error: null });
    listMock.mockResolvedValue({ data: [], error: null });
    removeMock.mockResolvedValue({ error: null });
  });

  describe("prepareBookUpload", () => {
    it("mints a signed upload url under <user_id>/<book_id>.pdf after inserting the books row", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 5_000_000);

      expect(fromMock).toHaveBeenCalledWith("books");
      expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, bookId: "book-1", path: "user-1/book-1.pdf", token: "upload-token-abc", contentType: "application/pdf" });
    });

    describe("EPUB / TXT / Markdown uploads (lesson ingestion beyond PDF)", () => {
      const insertedBook = () => {
        const i = fromMock.mock.calls.findIndex(([t]) => t === "books");
        return (fromMock.mock.results[i]!.value as { insert: { mock: { calls: unknown[][] } } }).insert.mock.calls[0]![0] as Record<string, unknown>;
      };

      it.each([
        ["Atomic Habits.epub", "user-1/book-1.epub", "application/epub+zip", "epub"],
        ["notes.txt", "user-1/book-1.txt", "text/plain", "text"],
        ["notes.MD", "user-1/book-1.md", "text/markdown", "text"],
        ["notes.markdown", "user-1/book-1.md", "text/markdown", "text"],
        ["Book.PDF", "user-1/book-1.pdf", "application/pdf", "pdf"],
      ])("%s: stored as %s, uploaded as %s, books.reader_source %s", async (filename, path, contentType, readerSource) => {
        const { prepareBookUpload } = await import("../self-mastery-actions");

        const result = await prepareBookUpload("A Book", "", "standard", 5_000_000, filename);

        expect(result).toMatchObject({ ok: true, path, contentType });
        expect(createSignedUploadUrlMock).toHaveBeenCalledWith(path);
        expect(insertedBook()).toMatchObject({ reader_source: readerSource });
      });

      it("refuses any other file type before touching the database or Storage", async () => {
        const { prepareBookUpload } = await import("../self-mastery-actions");

        for (const filename of ["paper.docx", "page.html", "archive.zip", "noextension"]) {
          const result = await prepareBookUpload("A Book", "", "standard", 5_000, filename);
          expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/PDF, EPUB, TXT or Markdown/) });
        }
        expect(fromMock).not.toHaveBeenCalled();
        expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
      });
    });

    // The whole point of this fix: a file far larger than Next's 1MB Server
    // Action body cap must still work, because its bytes never travel
    // through this function's own request body at all -- prepareBookUpload
    // only ever receives a `number` (fileSizeBytes), never a File/FormData.
    it("succeeds for a file far larger than Next's old 1MB server-action body cap", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Big Book", "", "standard", 40 * 1024 * 1024);

      expect(result.ok).toBe(true);
    });

    it("a user with NO key can still start an upload (no shared-key world: the book is created and readable; the key is dealt with at finalize)", async () => {
      hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: "Claude" });
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 5_000_000);

      expect(result).toMatchObject({ ok: true });
      expect(createSignedUploadUrlMock).toHaveBeenCalled();
    });

    it("driver down still refuses the upload (nothing would consume the queue) -- the key is never even looked at", async () => {
      isIngestionAvailableMock.mockResolvedValue(false);
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 5_000_000);

      expect(result).toEqual({ ok: false, message: "driver down message" });
      expect(hasUsableIngestionKeyMock).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("refuses a blank title before touching `books`", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("   ", "", "standard", 5_000_000);

      expect(result).toEqual({ ok: false, message: "Give this book a title." });
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("refuses a zero-byte file before touching `books`", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 0);

      expect(result).toEqual({ ok: false, message: "That file is empty." });
      expect(fromMock).not.toHaveBeenCalled();
    });

    // The real, honest limit (URGENT pdf-upload fix): a project-wide
    // Supabase Storage account ceiling of 50 MiB, not the old, never-
    // honored 200MB promise. Pinned to lib/self-mastery/book-upload-
    // limits.ts's exact constant/message, not a re-typed literal.
    it("rejects an oversize file with the honest 50MB message, without inserting a row", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");
      const { BOOK_MAX_SIZE_MESSAGE } = await import("@/lib/self-mastery/book-upload-limits");

      const result = await prepareBookUpload("A Book", "", "standard", 51 * 1024 * 1024);

      expect(result).toEqual({ ok: false, message: BOOK_MAX_SIZE_MESSAGE });
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("accepts a 49MB file", async () => {
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 49 * 1024 * 1024);

      expect(result.ok).toBe(true);
    });

    it("deletes the just-inserted row if minting the signed url fails, rather than stranding it", async () => {
      createSignedUploadUrlMock.mockResolvedValue({ data: null, error: { message: "storage down" } });
      const { prepareBookUpload } = await import("../self-mastery-actions");

      const result = await prepareBookUpload("A Book", "", "standard", 5_000_000);

      expect(result.ok).toBe(false);
      expect(fromMock).toHaveBeenCalledWith("books");
      // insert then delete -- both against `books`, no other table touched.
      expect(fromMock.mock.calls.every(([table]) => table === "books")).toBe(true);
    });

    describe("ingestion_mode threading (P2-14B, preserved)", () => {
      function captureInsertPayload() {
        let payload: Record<string, unknown> | undefined;
        fromResults.books = { data: { id: "book-1" }, error: null };
        fromMock.mockImplementation((table: string) => {
          if (table !== "books") return makeChain(fromResults[table] ?? { data: null, error: null });
          const chain = makeChain(fromResults.books!);
          chain.insert = vi.fn((p: Record<string, unknown>) => {
            payload = p;
            return chain;
          });
          return chain;
        });
        return { getPayload: () => payload };
      }

      it("defaults to 'standard' when omitted", async () => {
        const { getPayload } = captureInsertPayload();
        const { prepareBookUpload } = await import("../self-mastery-actions");

        await prepareBookUpload("A Book", "", "standard", 5_000_000);

        expect(getPayload()?.ingestion_mode).toBe("standard");
      });

      it("threads 'batch' through when the dialog set it", async () => {
        const { getPayload } = captureInsertPayload();
        const { prepareBookUpload } = await import("../self-mastery-actions");

        await prepareBookUpload("A Book", "", "batch", 5_000_000);

        expect(getPayload()?.ingestion_mode).toBe("batch");
      });

      it("an unrecognized value degrades to 'standard'", async () => {
        const { getPayload } = captureInsertPayload();
        const { prepareBookUpload } = await import("../self-mastery-actions");

        // @ts-expect-error -- exercising the defensive narrowing against a bad value
        await prepareBookUpload("A Book", "", "something-else", 5_000_000);

        expect(getPayload()?.ingestion_mode).toBe("standard");
      });
    });
  });

  describe("finalizeBookUpload", () => {
    beforeEach(() => {
      fromResults.books = { data: { id: "book-1", status: "uploading" }, error: null };
    });

    it("rejects a path that doesn't match this user's own deterministic <user_id>/<book_id>.pdf, without touching Storage", async () => {
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-2/book-1.pdf");

      expect(result.ok).toBe(false);
      expect(listMock).not.toHaveBeenCalled();
    });

    it("refuses to finalize a row that isn't in status 'uploading' (already finalized, or not found)", async () => {
      fromResults.books = { data: { id: "book-1", status: "processing" }, error: null };
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result.ok).toBe(false);
      expect(listMock).not.toHaveBeenCalled();
    });

    it("rejects when the uploaded object can't be found (upload never completed or expired)", async () => {
      listMock.mockResolvedValue({ data: [], error: null });
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result).toEqual({ ok: false, message: "Upload not found -- it may have failed or expired" });
    });

    it("re-reads the real object metadata from Storage (not client input), flips to processing, and enqueues an ingestion job", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 40 * 1024 * 1024, mimetype: "application/pdf" } }], error: null });
      fromResults.ingestion_jobs = { data: null, error: null };
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result).toEqual({ ok: true, bookId: "book-1" });
      expect(fromMock).toHaveBeenCalledWith("ingestion_jobs");
      expect(revalidatePathMock).toHaveBeenCalledWith("/personal/self_mastery");
      expect(revalidatePathMock).toHaveBeenCalledWith("/");
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("when the ingestion job can't be queued, takes the book back out (object + row) instead of stranding it at 'processing' with no job", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 1024, mimetype: "application/pdf" } }], error: null });
      fromResults.ingestion_jobs = { data: null, error: { message: "insert failed" } };
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result.ok).toBe(false);
      expect(removeMock).toHaveBeenCalledWith(["user-1/book-1.pdf"]);
      const deletedBooks = fromMock.mock.calls.some(([table], i) => {
        const chain = fromMock.mock.results[i]!.value as { delete: { mock: { calls: unknown[] } } };
        return table === "books" && chain.delete.mock.calls.length > 0;
      });
      expect(deletedBooks).toBe(true);
    });

    it("with NO usable key: the book is kept and readable but marked failed with the retryable no-key message, and NO job is queued", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 1024, mimetype: "application/pdf" } }], error: null });
      hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: "DeepSeek" });
      fromResults.ingestion_jobs = { data: null, error: null };
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result).toEqual({ ok: true, bookId: "book-1" });
      expect(fromMock).not.toHaveBeenCalledWith("ingestion_jobs");
      expect(removeMock).not.toHaveBeenCalled(); // the PDF stays: the reader (and a later Try again) need it
      const bookChains = fromMock.mock.calls.map(([t], i) => ({ t, chain: fromMock.mock.results[i]!.value as { update: { mock: { calls: unknown[][] } } } })).filter((c) => c.t === "books");
      const patches = bookChains.flatMap((c) => c.chain.update.mock.calls.map((a) => a[0] as Record<string, unknown>));
      expect(patches).toContainEqual(expect.objectContaining({ file_path: "user-1/book-1.pdf", status: "failed", error_message: expect.stringMatching(/Add an API key in Settings, or connect an agent.*then tap Try again/) }));
    });

    it("with NO key but a CONNECTED AGENT: the book is queued like any other (processing + a job), because the agent will do the model steps", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 1024, mimetype: "application/pdf" } }], error: null });
      hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: "DeepSeek" });
      hasAgentConnectorMock.mockResolvedValue(true);
      fromResults.ingestion_jobs = { data: null, error: null };
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result).toEqual({ ok: true, bookId: "book-1" });
      expect(fromMock).toHaveBeenCalledWith("ingestion_jobs");
      const bookChains = fromMock.mock.calls.map(([t], i) => ({ t, chain: fromMock.mock.results[i]!.value as { update: { mock: { calls: unknown[][] } } } })).filter((c) => c.t === "books");
      const patches = bookChains.flatMap((c) => c.chain.update.mock.calls.map((a) => a[0] as Record<string, unknown>));
      expect(patches).toContainEqual(expect.objectContaining({ status: "processing" }));
      expect(patches).not.toContainEqual(expect.objectContaining({ status: "failed" }));
    });

    describe("finalize for EPUB / TXT / Markdown", () => {
      afterEach(() => vi.unstubAllGlobals());
      const stored = (name: string, mimetype: string) => listMock.mockResolvedValue({ data: [{ name, metadata: { size: 2048, mimetype } }], error: null });

      it.each([
        ["user-1/book-1.epub", "book-1.epub", "application/epub+zip"],
        ["user-1/book-1.txt", "book-1.txt", "text/plain"],
        ["user-1/book-1.md", "book-1.md", "text/markdown"],
        ["user-1/book-1.md", "book-1.md", "text/plain"],
      ])("accepts %s with the stored type %s and queues the job", async (path, name, mimetype) => {
        stored(name, mimetype);
        fromResults.ingestion_jobs = { data: null, error: null };
        const { finalizeBookUpload } = await import("../self-mastery-actions");

        const result = await finalizeBookUpload("book-1", path);

        expect(result).toEqual({ ok: true, bookId: "book-1" });
        expect(listMock).toHaveBeenCalledWith("user-1", { search: name });
        expect(fromMock).toHaveBeenCalledWith("ingestion_jobs");
        expect(removeMock).not.toHaveBeenCalled();
      });

      it("removes the object and the row when the stored type does not match the extension (an .epub that is really text/plain)", async () => {
        stored("book-1.epub", "text/plain");
        const { finalizeBookUpload } = await import("../self-mastery-actions");

        const result = await finalizeBookUpload("book-1", "user-1/book-1.epub");

        expect(result.ok).toBe(false);
        expect(removeMock).toHaveBeenCalledWith(["user-1/book-1.epub"]);
      });

      it("refuses a path with an extension lesson ingestion does not accept, without touching Storage", async () => {
        const { finalizeBookUpload } = await import("../self-mastery-actions");
        const result = await finalizeBookUpload("book-1", "user-1/book-1.exe");
        expect(result.ok).toBe(false);
        expect(listMock).not.toHaveBeenCalled();
      });

      it("SNIFFS the first bytes: a .pdf that is not a PDF, an .epub that is not a zip, a .txt with NUL bytes are removed", async () => {
        const cases: [string, string, string, number[]][] = [
          ["user-1/book-1.pdf", "book-1.pdf", "application/pdf", [0x50, 0x4e, 0x47]],
          ["user-1/book-1.epub", "book-1.epub", "application/epub+zip", [0x25, 0x50, 0x44, 0x46]],
          ["user-1/book-1.txt", "book-1.txt", "text/plain", [0x68, 0x69, 0x00, 0x00]],
        ];
        for (const [path, name, mimetype, head] of cases) {
          vi.clearAllMocks();
          fromResults = { books: { data: { id: "book-1", status: "uploading" }, error: null } };
          isIngestionAvailableMock.mockResolvedValue(true);
          hasUsableIngestionKeyMock.mockResolvedValue({ usable: true, providerLabel: "DeepSeek" });
          stored(name, mimetype);
          createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
          vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(head), { status: 206 })));
          const { finalizeBookUpload } = await import("../self-mastery-actions");

          const result = await finalizeBookUpload("book-1", path);

          expect(result.ok, path).toBe(false);
          expect(removeMock, path).toHaveBeenCalledWith([path]);
        }
      });

      it("a sniff that cannot run (signed URL fails) does not block the upload: the worker re-validates the file itself", async () => {
        stored("book-1.epub", "application/epub+zip");
        createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "nope" } });
        fromResults.ingestion_jobs = { data: null, error: null };
        const { finalizeBookUpload } = await import("../self-mastery-actions");
        expect(await finalizeBookUpload("book-1", "user-1/book-1.epub")).toEqual({ ok: true, bookId: "book-1" });
      });
    });

    it("removes the object and deletes the row when the real object's mime type fails validation (bypassed the client-side check)", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 1024, mimetype: "text/plain" } }], error: null });
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result.ok).toBe(false);
      expect(removeMock).toHaveBeenCalledWith(["user-1/book-1.pdf"]);
    });

    it("removes the object and deletes the row when the real object exceeds the size ceiling", async () => {
      listMock.mockResolvedValue({ data: [{ name: "book-1.pdf", metadata: { size: 51 * 1024 * 1024, mimetype: "application/pdf" } }], error: null });
      const { finalizeBookUpload } = await import("../self-mastery-actions");

      const result = await finalizeBookUpload("book-1", "user-1/book-1.pdf");

      expect(result.ok).toBe(false);
      expect(removeMock).toHaveBeenCalledWith(["user-1/book-1.pdf"]);
    });
  });

  describe("retryBookIngestion", () => {
    const failedBook = (error_message: string | null) => ({ data: { id: "book-1", status: "failed", error_message }, error: null });

    it("puts a failed book back in the queue through the owner-checked RPC, and refreshes the library", async () => {
      fromResults.books = failedBook("Something went wrong while processing this book. Please try uploading it again.");
      const { retryBookIngestion } = await import("../self-mastery-actions");
      const result = await retryBookIngestion("book-1");
      expect(result).toEqual({ ok: true });
      expect(rpcMock).toHaveBeenCalledWith("retry_book_ingestion", { p_book_id: "book-1" });
      expect(revalidatePathMock).toHaveBeenCalledWith("/");
    });

    it("refuses a failure that is about the file itself (it would fail the same way) and never calls the RPC", async () => {
      fromResults.books = failedBook("This PDF is password-protected. Remove the password, then upload it again.");
      const { retryBookIngestion } = await import("../self-mastery-actions");
      const result = await retryBookIngestion("book-1");
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/password/) });
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("refuses when the driver is down or the key is missing, like upload does (a queued retry would sit forever)", async () => {
      fromResults.books = failedBook(null);
      const { retryBookIngestion } = await import("../self-mastery-actions");
      isIngestionAvailableMock.mockResolvedValue(false);
      expect(await retryBookIngestion("book-1")).toMatchObject({ ok: false });
      isIngestionAvailableMock.mockResolvedValue(true);
      hasUsableIngestionKeyMock.mockResolvedValue({ usable: false, providerLabel: "DeepSeek" });
      expect(await retryBookIngestion("book-1")).toMatchObject({ ok: false, message: expect.stringMatching(/API key/) });
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("refuses a book that isn't failed or isn't this user's", async () => {
      fromResults.books = { data: null, error: null };
      const { retryBookIngestion } = await import("../self-mastery-actions");
      expect(await retryBookIngestion("book-1")).toMatchObject({ ok: false });
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it.each([
      ["file_gone", /no longer stored/],
      ["has_history", /already studied/],
      ["not_failed", /can't be retried/],
      ["not_found", /can't be retried/],
    ])("RPC result %s becomes a plain message", async (rpcResult, message) => {
      fromResults.books = failedBook(null);
      rpcMock.mockResolvedValueOnce({ data: rpcResult, error: null });
      const { retryBookIngestion } = await import("../self-mastery-actions");
      expect(await retryBookIngestion("book-1")).toMatchObject({ ok: false, message: expect.stringMatching(message) });
    });

    it("an RPC error is a generic failure, not a thrown error", async () => {
      fromResults.books = failedBook(null);
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
      const { retryBookIngestion } = await import("../self-mastery-actions");
      expect(await retryBookIngestion("book-1")).toMatchObject({ ok: false });
    });
  });

  describe("cancelBookUpload -- the new orphan-cleanup risk this fix introduces", () => {
    it("removes the storage object and deletes the row when the book is still 'uploading'", async () => {
      fromResults.books = { data: { id: "book-1", status: "uploading" }, error: null };
      const { cancelBookUpload } = await import("../self-mastery-actions");

      await cancelBookUpload("book-1");

      expect(removeMock).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith("books");
    });

    it("removes whichever source file was uploaded (pdf, epub, txt or md) when the book is still 'uploading'", async () => {
      fromResults.books = { data: { id: "book-1", status: "uploading" }, error: null };
      const { cancelBookUpload } = await import("../self-mastery-actions");
      await cancelBookUpload("book-1");
      expect(removeMock).toHaveBeenCalledWith(["user-1/book-1.pdf", "user-1/book-1.epub", "user-1/book-1.txt", "user-1/book-1.md"]);
    });

    it("is a no-op for a book that already progressed past 'uploading' -- never deletes a book that's actually fine", async () => {
      fromResults.books = { data: { id: "book-1", status: "processing" }, error: null };
      const { cancelBookUpload } = await import("../self-mastery-actions");

      await cancelBookUpload("book-1");

      expect(removeMock).not.toHaveBeenCalled();
    });

    it("is a no-op for a book id that doesn't exist or isn't this user's", async () => {
      fromResults.books = { data: null, error: null };
      const { cancelBookUpload } = await import("../self-mastery-actions");

      await cancelBookUpload("book-missing");

      expect(removeMock).not.toHaveBeenCalled();
    });
  });
});
