import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { gcBookPdfAfterIngestion, isBookPdfGcEnabled } from "../book-pdf-gc";

function makeSupabase(opts: { removeError?: unknown; bookUpdateError?: unknown; enqueueError?: unknown } = {}) {
  const removeCalls: string[][] = [];
  const bookUpdateCalls: { vals: Record<string, unknown>; id: string }[] = [];
  const enqueueCalls: Record<string, unknown>[] = [];

  const supabase = {
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          removeCalls.push(paths);
          return { error: opts.removeError ?? null };
        },
      }),
    },
    from: (table: string) => {
      if (table === "books") {
        return {
          update: (vals: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              bookUpdateCalls.push({ vals, id });
              return { error: opts.bookUpdateError ?? null };
            },
          }),
        };
      }
      if (table === "pending_storage_deletions") {
        return {
          insert: async (vals: Record<string, unknown>) => {
            enqueueCalls.push(vals);
            return { error: opts.enqueueError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { supabase, removeCalls, bookUpdateCalls, enqueueCalls };
}

const TARGET = { bookId: "book-1", userId: "user-1", filePath: "user-1/book-1.pdf" };
const ENV_KEY = "SELF_MASTERY_GC_BOOK_PDF";

describe("isBookPdfGcEnabled", () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("is enabled by default (unset)", () => {
    delete process.env[ENV_KEY];
    expect(isBookPdfGcEnabled()).toBe(true);
  });

  it("is disabled only by the exact literal \"false\"", () => {
    process.env[ENV_KEY] = "false";
    expect(isBookPdfGcEnabled()).toBe(false);
  });

  it("stays enabled for any other value, including a truthy-looking typo", () => {
    process.env[ENV_KEY] = "False";
    expect(isBookPdfGcEnabled()).toBe(true);
    process.env[ENV_KEY] = "0";
    expect(isBookPdfGcEnabled()).toBe(true);
  });
});

describe("gcBookPdfAfterIngestion", () => {
  const original = process.env[ENV_KEY];
  beforeEach(() => {
    delete process.env[ENV_KEY]; // default: enabled
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("flag OFF: touches neither Storage nor the books row -- current behaviour exactly", async () => {
    process.env[ENV_KEY] = "false";
    const { supabase, removeCalls, bookUpdateCalls, enqueueCalls } = makeSupabase();

    await gcBookPdfAfterIngestion(supabase as never, TARGET);

    expect(removeCalls).toHaveLength(0);
    expect(bookUpdateCalls).toHaveLength(0);
    expect(enqueueCalls).toHaveLength(0);
  });

  it("flag ON, Storage delete succeeds: removes the object and nulls file_path, never touches pending_storage_deletions", async () => {
    const { supabase, removeCalls, bookUpdateCalls, enqueueCalls } = makeSupabase();

    await gcBookPdfAfterIngestion(supabase as never, TARGET);

    expect(removeCalls).toEqual([[TARGET.filePath]]);
    expect(bookUpdateCalls).toEqual([{ vals: { file_path: null }, id: TARGET.bookId }]);
    expect(enqueueCalls).toHaveLength(0);
  });

  it("Storage delete fails: enqueues pending_storage_deletions and does NOT null file_path (the object may still exist)", async () => {
    const { supabase, bookUpdateCalls, enqueueCalls } = makeSupabase({ removeError: new Error("storage unavailable") });

    await gcBookPdfAfterIngestion(supabase as never, TARGET);

    expect(bookUpdateCalls).toHaveLength(0);
    expect(enqueueCalls).toEqual([
      expect.objectContaining({ storage_path: TARGET.filePath, user_id: TARGET.userId, last_error: "storage unavailable" }),
    ]);
  });

  it("Storage delete fails AND the enqueue also fails: still resolves without throwing (never fails ingestion)", async () => {
    const { supabase } = makeSupabase({ removeError: new Error("storage unavailable"), enqueueError: new Error("db down") });

    await expect(gcBookPdfAfterIngestion(supabase as never, TARGET)).resolves.toBeUndefined();
  });

  it("Storage delete succeeds but nulling file_path fails: still resolves without throwing", async () => {
    const { supabase } = makeSupabase({ bookUpdateError: new Error("row locked") });

    await expect(gcBookPdfAfterIngestion(supabase as never, TARGET)).resolves.toBeUndefined();
  });
});
