import { describe, it, expect } from "vitest";
import { makeFakeDb } from "./fake-db";
import { sweepStuckBooks, STALLED_AFTER_MS } from "../stuck-sweep";

const NOW = new Date("2026-10-25T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const book = (id: string, over: Record<string, unknown> = {}) => ({ id, status: "processing", created_at: ago(3 * DAY), error_message: null, ...over });
const parked = (id: string, bookId: string, over: Record<string, unknown> = {}) => ({
  id, book_id: bookId, stage: "extracting_lessons", updated_at: ago(3 * DAY), leased_until: null, last_error: null, waiting_on_agent_since: ago(3 * DAY), ...over,
});
const step = (bookId: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `aj-${bookId}-${status}`, user_id: "u", kind: "self_mastery.book_stage", subject_type: "book", subject_id: bookId, status, expires_at: new Date(NOW.getTime() + DAY).toISOString(), ...over,
});

describe("sweepStuckBooks — a book parked for the owner's agent is waiting, not stuck", () => {
  it("never fails a parked job however long it has been untouched, while its agent steps are live", async () => {
    const d = makeFakeDb({ books: [book("b1")], ingestion_jobs: [parked("j1", "b1")], agent_jobs: [step("b1", "pending")] });
    expect(STALLED_AFTER_MS).toBeLessThan(3 * DAY);
    const r = await sweepStuckBooks(d.client, NOW);
    expect(r.failedStalled).toBe(0);
    expect(d.tables.ingestion_jobs![0]).toMatchObject({ stage: "extracting_lessons" });
    expect(d.tables.ingestion_jobs![0]!.waiting_on_agent_since).not.toBeNull(); // still parked
    expect(d.tables.books![0]!.status).toBe("processing");
  });

  it("a claimed step (the agent is mid-way) also counts as live", async () => {
    const d = makeFakeDb({ books: [book("b1")], ingestion_jobs: [parked("j1", "b1")], agent_jobs: [step("b1", "claimed")] });
    await sweepStuckBooks(d.client, NOW);
    expect(d.tables.ingestion_jobs![0]!.waiting_on_agent_since).not.toBeNull();
  });

  it("when no agent step is live any more (finished, expired or cancelled) it unparks the job so the pipeline re-plans: the planner then continues or fails the book with the real reason; the sweep itself never fails it", async () => {
    const d = makeFakeDb({ books: [book("b1")], ingestion_jobs: [parked("j1", "b1")], agent_jobs: [step("b1", "done"), step("b1", "expired")] });
    const r = await sweepStuckBooks(d.client, NOW);
    expect(r.failedStalled).toBe(0);
    expect(r.unparked).toBe(1);
    expect(d.tables.ingestion_jobs![0]!.waiting_on_agent_since).toBeNull();
    expect(d.tables.ingestion_jobs![0]!.stage).toBe("extracting_lessons");
    expect(d.tables.books![0]!.status).toBe("processing");
  });

  it("a live step past its expiry is not live (the agent sweep will expire it): the job is unparked", async () => {
    const d = makeFakeDb({ books: [book("b1")], ingestion_jobs: [parked("j1", "b1")], agent_jobs: [step("b1", "pending", { expires_at: ago(60_000) })] });
    await sweepStuckBooks(d.client, NOW);
    expect(d.tables.ingestion_jobs![0]!.waiting_on_agent_since).toBeNull();
  });

  it("another book's live steps do not keep this book parked", async () => {
    const d = makeFakeDb({ books: [book("b1"), book("b2")], ingestion_jobs: [parked("j1", "b1")], agent_jobs: [step("b2", "pending")] });
    await sweepStuckBooks(d.client, NOW);
    expect(d.tables.ingestion_jobs![0]!.waiting_on_agent_since).toBeNull();
  });

  it("positive control: an ordinary stalled job (not parked) is still failed", async () => {
    const d = makeFakeDb({ books: [book("b9")], ingestion_jobs: [parked("j9", "b9", { waiting_on_agent_since: null })], agent_jobs: [] });
    const r = await sweepStuckBooks(d.client, NOW);
    expect(r.failedStalled).toBe(1);
    expect(d.tables.books![0]!.status).toBe("failed");
  });
});
