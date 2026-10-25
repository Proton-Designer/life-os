import { describe, it, expect, vi } from "vitest";
import { sweepStuckBooks, NO_JOB_AFTER_MS, STALLED_AFTER_MS, SWEEP_LIMIT, STUCK_BOOK_MESSAGE } from "../stuck-sweep";

/** A small in-memory stand-in for the two tables, honouring only the filters the sweep uses. */
type Book = { id: string; status: string; created_at: string; error_message?: string | null };
type Job = { id: string; book_id: string; stage: string; updated_at: string; last_error?: string | null };

function fake(books: Book[], jobs: Job[]) {
  const limits: number[] = [];
  const from = (table: string) => {
    const rows = (table === "books" ? books : jobs) as Record<string, unknown>[];
    let working = rows.slice();
    let patch: Record<string, unknown> | null = null;
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.update = (p: Record<string, unknown>) => ((patch = p), c);
    c.eq = (col: string, v: unknown) => (filters.push((r) => r[col] === v), c);
    c.in = (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), c);
    c.lt = (col: string, v: string) => (filters.push((r) => String(r[col]) < v), c);
    c.not = (col: string, _op: string, v: string) => {
      const set = v.replace(/[()]/g, "").split(",");
      filters.push((r) => !set.includes(String(r[col])));
      return c;
    };
    c.order = () => c;
    c.limit = (n: number) => (limits.push(n), (working = working.slice(0, n)), c);
    c.returns = () => c;
    c.then = (resolve: (v: unknown) => void) => {
      const hit = working.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        hit.forEach((r) => Object.assign(r, patch));
        resolve({ data: null, error: null });
      } else resolve({ data: hit, error: null });
    };
    return c;
  };
  return { supabase: { from } as never, limits };
}

const NOW = new Date("2026-10-25T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("sweepStuckBooks", () => {
  it("fails a processing book that has had no job for over 10 minutes, with a retryable message", async () => {
    const books: Book[] = [{ id: "b1", status: "processing", created_at: ago(NO_JOB_AFTER_MS + 60_000) }];
    const { supabase } = fake(books, []);
    const r = await sweepStuckBooks(supabase, NOW);
    expect(r).toEqual({ failedNoJob: 1, failedStalled: 0 });
    expect(books[0]).toMatchObject({ status: "failed", error_message: STUCK_BOOK_MESSAGE });
  });

  it("leaves alone: a young book without a job yet, and an old processing book that has a live job", async () => {
    const books: Book[] = [
      { id: "young", status: "processing", created_at: ago(60_000) },
      { id: "busy", status: "processing", created_at: ago(5 * NO_JOB_AFTER_MS) },
    ];
    const jobs: Job[] = [{ id: "j1", book_id: "busy", stage: "extracting_lessons", updated_at: ago(30_000) }];
    const { supabase } = fake(books, jobs);
    expect(await sweepStuckBooks(supabase, NOW)).toEqual({ failedNoJob: 0, failedStalled: 0 });
    expect(books.map((b) => b.status)).toEqual(["processing", "processing"]);
  });

  it("fails a job untouched for over an hour (job and book), but not one that moved a minute ago, nor a done/failed one", async () => {
    const books: Book[] = ["dead", "alive", "done", "failed"].map((id) => ({ id, status: id === "done" ? "ready" : id === "failed" ? "failed" : "processing", created_at: ago(9 * STALLED_AFTER_MS) }));
    const jobs: Job[] = [
      { id: "jd", book_id: "dead", stage: "extracting_lessons", updated_at: ago(STALLED_AFTER_MS + 60_000) },
      { id: "ja", book_id: "alive", stage: "merging", updated_at: ago(60_000) },
      { id: "jn", book_id: "done", stage: "done", updated_at: ago(9 * STALLED_AFTER_MS) },
      { id: "jf", book_id: "failed", stage: "failed", updated_at: ago(9 * STALLED_AFTER_MS) },
    ];
    const { supabase } = fake(books, jobs);
    const r = await sweepStuckBooks(supabase, NOW);
    expect(r.failedStalled).toBe(1);
    expect(jobs.find((j) => j.id === "jd")).toMatchObject({ stage: "failed" });
    expect(books.find((b) => b.id === "dead")).toMatchObject({ status: "failed", error_message: STUCK_BOOK_MESSAGE });
    expect(jobs.find((j) => j.id === "ja")!.stage).toBe("merging");
    expect(books.find((b) => b.id === "done")!.status).toBe("ready");
  });

  it("is idempotent: a second poll finds nothing left to do", async () => {
    const books: Book[] = [{ id: "b1", status: "processing", created_at: ago(2 * NO_JOB_AFTER_MS) }];
    const { supabase } = fake(books, []);
    await sweepStuckBooks(supabase, NOW);
    expect(await sweepStuckBooks(supabase, NOW)).toEqual({ failedNoJob: 0, failedStalled: 0 });
  });

  it("is bounded: every query is limited to SWEEP_LIMIT rows per poll", async () => {
    const { supabase, limits } = fake([], []);
    await sweepStuckBooks(supabase, NOW);
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((n) => n === SWEEP_LIMIT)).toBe(true);
  });

  it("never throws: housekeeping must not break the poll", async () => {
    const broken = { from: () => { throw new Error("db down"); } } as never;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sweepStuckBooks(broken, NOW)).resolves.toEqual({ failedNoJob: 0, failedStalled: 0 });
    spy.mockRestore();
  });
});
