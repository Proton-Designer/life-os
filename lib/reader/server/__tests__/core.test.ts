import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb } from "./fake-db";
import {
  cancelReaderImportCore,
  confirmReaderImportCore,
  createHighlightCore,
  createReaderImportCore,
  deleteBookCore,
  getReaderBootstrapCore,
  getReadingStatsCore,
  listHighlightsCore,
  prepareReaderDocCore,
  recordReaderSessionCore,
  renameBookCore,
  saveReaderPositionCore,
  updateReaderSettingsCore,
  IMPORT_PLACEHOLDER_TITLE,
  type Db,
} from "../core";
import { makePdf } from "@/lib/reader/import/__tests__/helpers";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BOOK = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-19T23:30:00Z");

let fake: FakeDb;
const db = () => fake as unknown as Db;

beforeEach(() => {
  fake = new FakeDb();
});

const PASTE = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} has some words that make a sentence about reading quickly and well.`).join("\n\n");

async function createdPaste(text = PASTE) {
  const created = await createReaderImportCore(db(), ME, { kind: "paste" }, NOW);
  if (!created.ok) throw new Error(created.message);
  fake.put(`${ME}/${created.bookId}/source.txt`, text);
  return created.bookId;
}

describe("createReaderImportCore", () => {
  it("creates a ready, lesson-less reader book that never enters ingestion, and mints an upload for paste", async () => {
    const r = await createReaderImportCore(db(), ME, { kind: "paste" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.upload?.path).toBe(`${ME}/${r.bookId}/source.txt`);
    const row = fake.tables.books[0];
    expect(row).toMatchObject({ user_id: ME, status: "ready", stage: "done", lesson_count: 0, ingestion_mode: "reader", reader_status: "preparing", reader_source: "paste" });
    expect(fake.tables.ingestion_jobs ?? []).toHaveLength(0);
  });

  it("file: validates extension + size, and builds the path from the server-side user id", async () => {
    const bad = await createReaderImportCore(db(), ME, { kind: "file", filename: "x.exe", fileSizeBytes: 10 }, NOW);
    expect(bad).toMatchObject({ ok: false, code: "unsupported_type" });
    const big = await createReaderImportCore(db(), ME, { kind: "file", filename: "x.pdf", fileSizeBytes: 999_999_999 }, NOW);
    expect(big.ok).toBe(false);
    const ok = await createReaderImportCore(db(), ME, { kind: "file", filename: "My Book.EPUB", fileSizeBytes: 1000 }, NOW);
    expect(ok.ok && ok.upload?.path).toBe(`${ME}/${ok.ok ? ok.bookId : ""}/source.epub`);
    expect(fake.tables.books.at(-1)).toMatchObject({ reader_source: "epub" });
  });

  it("url: rejects private addresses before any row exists; accepts a public link without an upload", async () => {
    const priv = await createReaderImportCore(db(), ME, { kind: "url", url: "http://127.0.0.1/admin" }, NOW);
    expect(priv.ok).toBe(false);
    expect(fake.tables.books ?? []).toHaveLength(0);
    const pub = await createReaderImportCore(db(), ME, { kind: "url", url: "https://example.com/a" }, NOW);
    expect(pub).toMatchObject({ ok: true, upload: null });
    expect(fake.tables.books[0]).toMatchObject({ reader_source: "url", reader_source_url: "https://example.com/a" });
  });

  it("sweeps this user's abandoned (old, unconfirmed) imports - and only theirs", async () => {
    const old = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    fake.seed("books", [
      { id: "old-me", user_id: ME, ingestion_mode: "reader", reader_status: "preparing", created_at: old },
      { id: "old-failed", user_id: ME, ingestion_mode: "reader", reader_status: "failed", created_at: old },
      { id: "old-ready", user_id: ME, ingestion_mode: "reader", reader_status: "ready", created_at: old },
      { id: "old-other", user_id: OTHER, ingestion_mode: "reader", reader_status: "preparing", created_at: old },
    ]);
    fake.put(`${ME}/old-me/source.txt`, "x");
    await createReaderImportCore(db(), ME, { kind: "paste" }, NOW);
    const ids = fake.tables.books.map((b) => b.id);
    expect(ids).not.toContain("old-me");
    expect(ids).not.toContain("old-failed");
    expect(ids).toContain("old-ready");
    expect(ids).toContain("old-other");
    expect(fake.objects.has(`${ME}/old-me/source.txt`)).toBe(false);
  });
});

describe("prepareReaderDocCore", () => {
  it("builds + stores the document, fills the real title, marks ready, returns a preview", async () => {
    const bookId = await createdPaste();
    const r = await prepareReaderDocCore(db(), ME, bookId);
    if (!r.ok) throw new Error(`prepare failed: ${r.message} (${r.code})`);
    expect(r.ok).toBe(true);
    expect(r.preview.wordCount).toBeGreaterThan(40);
    expect(r.preview.sample.length).toBeGreaterThan(0);
    const row = fake.tables.books[0];
    expect(row).toMatchObject({ reader_status: "ready", reader_doc_version: 1, reader_word_count: r.preview.wordCount });
    expect(row.title).not.toBe(IMPORT_PLACEHOLDER_TITLE);
    const stored = JSON.parse(new TextDecoder().decode(fake.objects.get(`${ME}/${bookId}/reader-v1.json`)));
    expect(stored.wordCount).toBe(r.preview.wordCount);
  });

  it("a second prepare of a ready book returns the stored preview without rebuilding", async () => {
    const bookId = await createdPaste();
    await prepareReaderDocCore(db(), ME, bookId);
    fake.objects.delete(`${ME}/${bookId}/source.txt`); // a rebuild would now fail
    const again = await prepareReaderDocCore(db(), ME, bookId);
    expect(again.ok).toBe(true);
  });

  it("a failing import marks the row failed with the message and returns the typed code", async () => {
    const bookId = await createdPaste("   \n  ");
    const r = await prepareReaderDocCore(db(), ME, bookId);
    expect(r).toMatchObject({ ok: false, code: "empty" });
    expect(fake.tables.books[0]).toMatchObject({ reader_status: "failed" });
    expect(String(fake.tables.books[0].reader_error)).toMatch(/text/);
  });

  it("a missing upload is reported, not thrown", async () => {
    const created = await createReaderImportCore(db(), ME, { kind: "file", filename: "a.pdf", fileSizeBytes: 10 }, NOW);
    if (!created.ok) throw new Error("setup");
    const r = await prepareReaderDocCore(db(), ME, created.bookId);
    expect(r.ok).toBe(false);
  });

  it("lazy path: an already-ingested PDF book (reader_status none) is built from file_path and stays status 'ready'", async () => {
    const pdf = makePdf([{ lines: ["Chapter One", "The quick brown fox jumps over the lazy dog near the quiet river bank today.", "A second sentence follows here with several more plain words to read."] }]);
    fake.put(`${ME}/${BOOK}.pdf`, pdf);
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "Atomic Thing", author: "A. Writer", status: "ready", ingestion_mode: "standard", reader_status: "none", file_path: `${ME}/${BOOK}.pdf`, lesson_count: 12 }]);
    const r = await prepareReaderDocCore(db(), ME, BOOK);
    expect(r.ok).toBe(true);
    expect(fake.tables.books[0]).toMatchObject({ title: "Atomic Thing", reader_status: "ready", lesson_count: 12, ingestion_mode: "standard" });
  });

  it("lazy-path failure on an ingested book resets to 'none' (the book is not a failed import)", async () => {
    fake.put(`${ME}/${BOOK}.pdf`, new TextEncoder().encode("not a pdf at all, just words"));
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "T", status: "ready", ingestion_mode: "standard", reader_status: "none", file_path: `${ME}/${BOOK}.pdf` }]);
    const r = await prepareReaderDocCore(db(), ME, BOOK);
    expect(r.ok).toBe(false);
    expect(fake.tables.books[0].reader_status).toBe("none");
  });

  it("cannot prepare someone else's book (explicit user_id filter, no RLS in the fake)", async () => {
    fake.seed("books", [{ id: BOOK, user_id: OTHER, title: "Theirs", ingestion_mode: "standard", reader_status: "none", file_path: `${OTHER}/${BOOK}.pdf` }]);
    const r = await prepareReaderDocCore(db(), ME, BOOK);
    expect(r).toMatchObject({ ok: false });
    expect(fake.tables.books[0].reader_status).toBe("none");
  });
});

describe("confirm / cancel / rename / delete", () => {
  it("confirm applies edited title + author, only for a ready book", async () => {
    const bookId = await createdPaste();
    expect((await confirmReaderImportCore(db(), ME, bookId, { title: "X" })).ok).toBe(false); // not ready yet
    await prepareReaderDocCore(db(), ME, bookId);
    expect(await confirmReaderImportCore(db(), ME, bookId, { title: "  My   Title ", author: "Me" })).toEqual({ ok: true });
    expect(fake.tables.books[0]).toMatchObject({ title: "My Title", author: "Me" });
    expect((await confirmReaderImportCore(db(), ME, bookId, { title: "   " })).ok).toBe(false);
  });

  it("cancel removes the row and its objects; it will not delete an ingested (non-reader) book", async () => {
    const bookId = await createdPaste();
    await prepareReaderDocCore(db(), ME, bookId);
    expect(await cancelReaderImportCore(db(), ME, bookId, { includeReady: true })).toEqual({ ok: true });
    expect(fake.tables.books).toHaveLength(0);
    expect([...fake.objects.keys()].filter((k) => k.startsWith(`${ME}/${bookId}/`))).toHaveLength(0);

    fake.seed("books", [{ id: BOOK, user_id: ME, title: "Real", ingestion_mode: "standard", reader_status: "none" }]);
    await cancelReaderImportCore(db(), ME, BOOK, { includeReady: true });
    expect(fake.tables.books).toHaveLength(1);
  });

  it("cancel leaves a 'ready' import alone unless asked (a stale cancel must not delete a confirmed book)", async () => {
    const bookId = await createdPaste();
    await prepareReaderDocCore(db(), ME, bookId);
    await cancelReaderImportCore(db(), ME, bookId);
    expect(fake.tables.books).toHaveLength(1);
  });

  it("rename changes title (and author when given) for the owner only", async () => {
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "Old", author: "A" }]);
    expect(await renameBookCore(db(), ME, BOOK, { title: "New" })).toEqual({ ok: true });
    expect(fake.tables.books[0]).toMatchObject({ title: "New", author: "A" });
    expect(await renameBookCore(db(), ME, BOOK, { title: "N2", author: null })).toEqual({ ok: true });
    expect(fake.tables.books[0].author).toBeNull();
    expect((await renameBookCore(db(), OTHER, BOOK, { title: "Hijack" })).ok).toBe(false);
    expect(fake.tables.books[0].title).toBe("N2");
  });

  it("delete: a hard delete also removes reader objects + the pdf; a soft delete keeps them for restore", async () => {
    fake.put(`${ME}/${BOOK}/reader-v1.json`, "{}");
    fake.put(`${ME}/${BOOK}/source.epub`, "x");
    fake.put(`${ME}/${BOOK}.pdf`, "x");
    fake.rpcHandlers.delete_book = () => ({ data: { hard_deleted: true, storage_path: `${ME}/${BOOK}.pdf` }, error: null });
    expect(await deleteBookCore(db(), ME, BOOK)).toEqual({ ok: true, hardDeleted: true });
    expect(fake.objects.size).toBe(0);

    fake.put(`${ME}/${BOOK}/reader-v1.json`, "{}");
    fake.rpcHandlers.delete_book = () => ({ data: { hard_deleted: false, storage_path: null }, error: null });
    expect(await deleteBookCore(db(), ME, BOOK)).toEqual({ ok: true, hardDeleted: false });
    expect(fake.objects.has(`${ME}/${BOOK}/reader-v1.json`)).toBe(true);
  });

  it("delete surfaces an RPC error as a failure, never as success", async () => {
    fake.rpcHandlers.delete_book = () => ({ data: null, error: { message: "delete_book: book not found for caller" } });
    expect((await deleteBookCore(db(), ME, BOOK)).ok).toBe(false);
  });
});

describe("getReaderBootstrapCore", () => {
  it("returns the signed doc url, bookmark, settings defaults and highlights for a ready book", async () => {
    const bookId = await createdPaste();
    await prepareReaderDocCore(db(), ME, bookId);
    fake.seed("reader_positions", [{ user_id: ME, book_id: bookId, word_index: 42, wpm: 350, client_updated_at: "2026-10-19T20:00:00Z" }]);
    fake.seed("reader_highlights", [{ id: "h1", user_id: ME, book_id: bookId, start_word: 3, end_word: 6, text: "some words", note: null, created_at: "2026-10-19T21:00:00Z" }]);
    const r = await getReaderBootstrapCore(db(), ME, bookId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bootstrap.docUrl).toContain("reader-v1.json");
    expect(r.bootstrap.position).toEqual({ wordIndex: 42, wpm: 350, clientUpdatedAt: "2026-10-19T20:00:00Z" });
    expect(r.bootstrap.settings.wpm).toBe(300);
    expect(r.bootstrap.highlights).toHaveLength(1);
  });

  it("a book that still needs preparing has no doc url (the reader shows 'Preparing for reading')", async () => {
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "T", reader_status: "none" }]);
    const r = await getReaderBootstrapCore(db(), ME, BOOK);
    expect(r.ok && r.bootstrap.docUrl).toBeNull();
  });

  it("another user's position and highlights never leak into the bootstrap", async () => {
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "T", reader_status: "none" }]);
    fake.seed("reader_positions", [{ user_id: OTHER, book_id: BOOK, word_index: 999, wpm: 900, client_updated_at: "2026-10-19T20:00:00Z" }]);
    fake.seed("reader_highlights", [{ id: "h", user_id: OTHER, book_id: BOOK, start_word: 0, end_word: 1, text: "secret", created_at: "2026-10-19T21:00:00Z" }]);
    const r = await getReaderBootstrapCore(db(), ME, BOOK);
    expect(r.ok && r.bootstrap.position).toBeNull();
    expect(r.ok && r.bootstrap.highlights).toHaveLength(0);
  });

  it("someone else's book is 'not found'", async () => {
    fake.seed("books", [{ id: BOOK, user_id: OTHER, title: "T", reader_status: "ready" }]);
    expect((await getReaderBootstrapCore(db(), ME, BOOK)).ok).toBe(false);
  });
});

describe("saveReaderPositionCore", () => {
  beforeEach(() => {
    fake.seed("books", [{ id: BOOK, user_id: ME, title: "T" }]);
    fake.rpcHandlers.reader_save_position = (a) => ({ data: a.p_word_index, error: null });
  });
  const input = (over: object = {}) => ({ bookId: BOOK, wordIndex: 10, wpm: 320, clientUpdatedAt: "2026-10-19T23:29:00Z", ...over });

  it("calls the newest-wins RPC with the validated values and returns the stored index", async () => {
    fake.rpcHandlers.reader_save_position = () => ({ data: 77, error: null }); // the stored (newer) value won
    const r = await saveReaderPositionCore(db(), ME, input(), NOW);
    expect(r).toEqual({ ok: true, wordIndex: 77 });
    expect(fake.rpcCalls[0]).toEqual({ fn: "reader_save_position", args: { p_book_id: BOOK, p_word_index: 10, p_wpm: 320, p_client_updated_at: "2026-10-19T23:29:00.000Z" } });
  });

  it("rejects bad input without touching the database", async () => {
    for (const bad of [input({ wordIndex: -1 }), input({ wordIndex: 1.5 }), input({ bookId: "nope" }), input({ clientUpdatedAt: "yesterday-ish" }), input({ clientUpdatedAt: "2030-01-01T00:00:00Z" }), null, "x"]) {
      expect((await saveReaderPositionCore(db(), ME, bad, NOW)).ok).toBe(false);
    }
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("refuses a book the caller doesn't own", async () => {
    expect((await saveReaderPositionCore(db(), OTHER, input(), NOW)).ok).toBe(false);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("a cosmetic wpm problem never loses the save", async () => {
    const r = await saveReaderPositionCore(db(), ME, input({ wpm: "fast" }), NOW);
    expect(r.ok).toBe(true);
    expect(fake.rpcCalls[0].args.p_wpm).toBe(300);
  });
});

describe("highlights", () => {
  beforeEach(() => {
    fake.seed("books", [
      { id: BOOK, user_id: ME, title: "Book A", reader_word_count: 100 },
      { id: "44444444-4444-4444-8444-444444444444", user_id: ME, title: "Book B", reader_word_count: 100 },
    ]);
  });
  const hl = (over: object = {}) => ({ bookId: BOOK, startWord: 5, endWord: 9, text: "five whole words right here", ...over });

  it("creates, de-duplicates the same range, and lists per book", async () => {
    const a = await createHighlightCore(db(), ME, hl());
    const b = await createHighlightCore(db(), ME, hl());
    expect(a.ok && b.ok && a.highlight.id === b.highlight.id).toBe(true);
    expect(fake.tables.reader_highlights).toHaveLength(1);
    const list = await listHighlightsCore(db(), ME, BOOK);
    expect(list.ok && list.highlights.map((h) => h.bookTitle)).toEqual(["Book A"]);
  });

  it("global list spans books, newest first, with titles", async () => {
    await createHighlightCore(db(), ME, hl());
    await createHighlightCore(db(), ME, hl({ bookId: "44444444-4444-4444-8444-444444444444", startWord: 1, endWord: 2 }));
    const all = await listHighlightsCore(db(), ME, null);
    expect(all.ok && all.highlights.map((h) => h.bookTitle)).toEqual(["Book B", "Book A"]);
  });

  it("rejects a range past the end of the book, an inverted range, empty text", async () => {
    expect((await createHighlightCore(db(), ME, hl({ endWord: 100 }))).ok).toBe(false);
    expect((await createHighlightCore(db(), ME, hl({ startWord: 9, endWord: 5 }))).ok).toBe(false);
    expect((await createHighlightCore(db(), ME, hl({ text: "   " }))).ok).toBe(false);
    expect(fake.tables.reader_highlights ?? []).toHaveLength(0);
  });

  it("won't highlight in a book you don't own", async () => {
    expect((await createHighlightCore(db(), OTHER, hl())).ok).toBe(false);
  });
});

describe("sessions + stats", () => {
  beforeEach(() => fake.seed("books", [{ id: BOOK, user_id: ME, title: "T" }]));
  const session = (over: object = {}) => ({ bookId: BOOK, startedAt: "2026-10-19T23:10:00Z", endedAt: "2026-10-19T23:20:00Z", wordsRead: 1500, mode: "rsvp", avgWpm: 300, ...over });

  it("local_date is the USER's local day, not the UTC day (the evening-rollover bug class)", async () => {
    // 23:20 UTC on Oct 19 is 6:20 PM in Chicago (same day) but 7:20 AM Oct 20 in Auckland.
    await recordReaderSessionCore(db(), ME, "America/Chicago", session(), NOW);
    await recordReaderSessionCore(db(), ME, "Pacific/Auckland", session({ endedAt: "2026-10-19T23:20:00Z" }), NOW);
    expect(fake.tables.reader_sessions.map((s) => s.local_date)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("zero-word stretches are not sessions; a book you don't own is refused", async () => {
    expect(await recordReaderSessionCore(db(), ME, "UTC", session({ wordsRead: 0 }), NOW)).toEqual({ ok: true, recorded: false });
    expect((await recordReaderSessionCore(db(), OTHER, "UTC", session(), NOW)).ok).toBe(false);
    expect(fake.tables.reader_sessions ?? []).toHaveLength(0);
  });

  it("rejects impossible sessions", async () => {
    for (const bad of [session({ mode: "skim" }), session({ wordsRead: -5 }), session({ wordsRead: 99999999 }), session({ startedAt: "2026-10-19T23:25:00Z" }), session({ endedAt: "2031-01-01T00:00:00Z" })]) {
      expect((await recordReaderSessionCore(db(), ME, "UTC", bad, NOW)).ok).toBe(false);
    }
  });

  it("stats: today's words, goal, streak, weighted average speed", async () => {
    fake.seed("user_settings", [{ user_id: ME, reader_wpm: 300, reader_font_scale: 1, reader_theme: "dark", reader_voice_uri: null, reader_speech_rate: 1, reader_focal_lines: true, reader_daily_word_goal: 1000 }]);
    fake.seed("reader_sessions", [
      { user_id: ME, local_date: "2026-10-19", words_read: 800, avg_wpm: 300 },
      { user_id: ME, local_date: "2026-10-19", words_read: 400, avg_wpm: 600 },
      { user_id: ME, local_date: "2026-10-18", words_read: 1200, avg_wpm: 300 },
      { user_id: ME, local_date: "2026-10-17", words_read: 1000, avg_wpm: 300 },
      { user_id: ME, local_date: "2026-10-15", words_read: 5000, avg_wpm: 300 }, // gap on the 16th breaks the run
      { user_id: OTHER, local_date: "2026-10-19", words_read: 99999, avg_wpm: 100 },
    ]);
    const r = await getReadingStatsCore(db(), ME, "America/Chicago", NOW);
    if (!r.ok) throw new Error(r.message);
    expect(r.stats).toMatchObject({ today: "2026-10-19", todayWords: 1200, dailyWordGoal: 1000, goalMet: true, streak: 3 });
    expect(r.stats.avgWpm).toBe(Math.round((800 * 300 + 400 * 600 + 1200 * 300 + 1000 * 300 + 5000 * 300) / 8400));
  });
});

describe("updateReaderSettingsCore", () => {
  it("upserts only the provided fields and returns the full settings", async () => {
    const r = await updateReaderSettingsCore(db(), ME, { wpm: 450, theme: "sepia", dailyWordGoal: 2000 });
    expect(r.ok && r.settings).toMatchObject({ wpm: 450, theme: "sepia", dailyWordGoal: 2000, focalLines: true });
    expect(fake.tables.user_settings[0]).toMatchObject({ user_id: ME, reader_wpm: 450, reader_theme: "sepia", reader_daily_word_goal: 2000 });
    expect(fake.tables.user_settings[0]).not.toHaveProperty("reader_font_scale");
  });

  it("rejects out-of-range values with a message and writes nothing", async () => {
    for (const bad of [{ wpm: 50 }, { wpm: 5000 }, { theme: "neon" }, { fontScale: 5 }, { speechRate: 0.1 }, { focalLines: "yes" }, { dailyWordGoal: 0 }, "x"]) {
      expect((await updateReaderSettingsCore(db(), ME, bad)).ok).toBe(false);
    }
    expect(fake.tables.user_settings ?? []).toHaveLength(0);
  });

  it("goal can be switched off with null; unknown keys are ignored", async () => {
    await updateReaderSettingsCore(db(), ME, { dailyWordGoal: 500 });
    const r = await updateReaderSettingsCore(db(), ME, { dailyWordGoal: null, isAdmin: true });
    expect(r.ok && r.settings.dailyWordGoal).toBeNull();
    expect(fake.tables.user_settings[0]).not.toHaveProperty("isAdmin");
  });
});
