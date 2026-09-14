import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * S6, 2026-09-14. Covers only the NEW logic this pass adds — the
 * ingestion_jobs.updated_at lookup and its wiring into `looksStalled` — not
 * the whole file's pre-existing behaviour (memory strength, lesson mapping),
 * which book-lesson-strength-consistency.test.ts already exercises.
 */

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => chain);
  chain.returns = vi.fn(() => Promise.resolve(result));
  return chain;
}

let responses: Record<string, { data: unknown; error: unknown }>;
const fromMock = vi.fn((table: string) => makeChain(responses[table] ?? { data: null, error: null }));
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock }, userId: "user-1" }));

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const BASE_BOOK = {
  id: "book-1",
  title: "Atomic Habits",
  author: null,
  progress_pct: 75,
  error_message: null,
  created_at: "2026-09-14T10:00:00.000Z",
  ready_at: null,
};

describe("getBookDetail — stalled detection (S6)", () => {
  beforeEach(() => {
    vi.resetModules();
    fromMock.mockClear();
    responses = {
      lessons: { data: [], error: null },
      cards: { data: [], error: null },
    };
  });

  it("is stalled when mid-pipeline and ingestion_jobs.updated_at is old", async () => {
    responses.books = { data: { ...BASE_BOOK, status: "processing", stage: "generating_cards" }, error: null };
    const staleUpdatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min old
    responses.ingestion_jobs = { data: { updated_at: staleUpdatedAt }, error: null };

    const { getBookDetail } = await import("../get-book-detail");
    const detail = await getBookDetail("book-1");
    expect(detail?.looksStalled).toBe(true);
  });

  it("is NOT stalled when mid-pipeline and ingestion_jobs.updated_at is recent", async () => {
    responses.books = { data: { ...BASE_BOOK, status: "processing", stage: "generating_cards" }, error: null };
    const recentUpdatedAt = new Date(Date.now() - 30 * 1000).toISOString(); // 30s old
    responses.ingestion_jobs = { data: { updated_at: recentUpdatedAt }, error: null };

    const { getBookDetail } = await import("../get-book-detail");
    const detail = await getBookDetail("book-1");
    expect(detail?.looksStalled).toBe(false);
  });

  it("is NOT stalled when there is no ingestion_jobs row at all (e.g. a seeded starter deck)", async () => {
    responses.books = { data: { ...BASE_BOOK, status: "processing", stage: "extracting_lessons" }, error: null };
    responses.ingestion_jobs = { data: null, error: null };

    const { getBookDetail } = await import("../get-book-detail");
    const detail = await getBookDetail("book-1");
    expect(detail?.looksStalled).toBe(false);
  });

  it("never queries ingestion_jobs for a ready book -- stalled is a meaningless question once it's done", async () => {
    responses.books = { data: { ...BASE_BOOK, status: "ready", stage: "done", progress_pct: 100 }, error: null };

    const { getBookDetail } = await import("../get-book-detail");
    const detail = await getBookDetail("book-1");
    expect(detail?.looksStalled).toBe(false);
    expect(fromMock).not.toHaveBeenCalledWith("ingestion_jobs");
  });

  it("never queries ingestion_jobs for a failed book", async () => {
    responses.books = { data: { ...BASE_BOOK, status: "failed", stage: "extracting_lessons", error_message: "boom" }, error: null };

    const { getBookDetail } = await import("../get-book-detail");
    const detail = await getBookDetail("book-1");
    expect(detail?.looksStalled).toBe(false);
    expect(fromMock).not.toHaveBeenCalledWith("ingestion_jobs");
  });
});
