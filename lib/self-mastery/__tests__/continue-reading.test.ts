import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn(), getProfile: vi.fn() }));
import { FakeDb } from "@/lib/reader/server/__tests__/fake-db";
import type { Db } from "@/lib/reader/server/core";
import { getContinueReadingCore } from "../continue-reading";

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-19T18:00:00Z");

function seed() {
  const db = new FakeDb();
  db.seed("books", [
    { id: B1, user_id: U, title: "Older", reader_status: "ready", reader_word_count: 1000 },
    { id: B2, user_id: U, title: "Newest", reader_status: "ready", reader_word_count: 2000 },
  ]);
  db.seed("reader_positions", [
    { user_id: U, book_id: B1, word_index: 100, updated_at: "2026-10-18T10:00:00Z" },
    { user_id: U, book_id: B2, word_index: 500, updated_at: "2026-10-19T10:00:00Z" },
  ]);
  db.seed("user_settings", [{ user_id: U, reader_daily_word_goal: 1000 }]);
  db.seed("reader_sessions", [{ user_id: U, local_date: "2026-10-19", words_read: 320, avg_wpm: 300 }]);
  return db;
}

describe("getContinueReadingCore", () => {
  it("returns the most recently read book with progress and today's words", async () => {
    const r = await getContinueReadingCore(seed() as unknown as Db, U, "America/Chicago", NOW);
    expect(r).toMatchObject({ bookId: B2, title: "Newest", progressPct: 25, todayWords: 320, dailyWordGoal: 1000 });
  });
  it("null when the person has never read in the reader", async () => {
    expect(await getContinueReadingCore(new FakeDb() as unknown as Db, U, "UTC", NOW)).toBeNull();
  });
  it("falls back to the next bookmark when the newest book is still preparing or gone", async () => {
    const db = seed();
    db.tables.books[1].reader_status = "preparing";
    expect((await getContinueReadingCore(db as unknown as Db, U, "UTC", NOW))?.bookId).toBe(B1);
    db.tables.books.splice(1, 1); // deleted: RLS hides the row
    expect((await getContinueReadingCore(db as unknown as Db, U, "UTC", NOW))?.bookId).toBe(B1);
  });
  it("null when no bookmarked book is ready (positive control for the fallback)", async () => {
    const db = seed();
    db.tables.books[0].reader_status = "failed";
    db.tables.books[1].reader_status = "preparing";
    expect(await getContinueReadingCore(db as unknown as Db, U, "UTC", NOW)).toBeNull();
  });
  it("positive control: another user's bookmark is never used (explicit user_id filter)", async () => {
    const db = seed();
    db.seed("reader_positions", [{ user_id: OTHER, book_id: B1, word_index: 900, updated_at: "2026-10-20T10:00:00Z" }]);
    const r = await getContinueReadingCore(db as unknown as Db, U, "UTC", NOW);
    expect(r?.bookId).toBe(B2);
  });
});
