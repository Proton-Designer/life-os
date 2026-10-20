import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { BOOK_MAX_BYTES, BOOK_MAX_SIZE_MESSAGE } from "@/lib/self-mastery/book-upload-limits";
import {
  importChunks,
  importFile,
  importPaste,
  importUrl,
  makePreview,
  ReaderImportError,
  type ChunkInput,
  type ImportResult,
  type SectionInput,
} from "@/lib/reader/import";
import { isIP } from "node:net";
import { isBlockedAddress } from "@/lib/reader/import";
import { parseImportUrl } from "@/lib/reader/import/url";
import { toReaderImportError } from "@/lib/reader/import/errors";
import {
  DEFAULT_READER_SETTINGS,
  READER_DOC_VERSION,
  type ReaderDoc,
  type ReaderImportErrorCode,
  type ReaderImportPreview,
  type ReaderSettings,
  type ReaderSource,
} from "@/lib/reader/types";
import {
  ReaderInputError,
  parseAuthor,
  parseHighlightInput,
  parsePositionInput,
  parseSessionInput,
  parseSettingsPatch,
  parseTitle,
  parseUuid,
  asObject,
} from "./validate";
import { BOOKS_BUCKET, readerDocPath, readerFolder, mimeForExtension, readerSourcePath, sourceExtension, sourceKindForExtension } from "./paths";
import { computeReadingStats, STATS_WINDOW_DAYS, type ReadingStats } from "./stats";

// Testable cores for app/(app)/personal/reader-actions.ts and app/api/reader/position/route.ts.
// Same rule as lib/settings/actions-core.ts: these take (supabase, userId, ...) and NEVER call
// requireUser()/getProfile() themselves. Every query also filters on user_id explicitly (RLS is the
// backstop, not the only guard), and storage paths are recomputed from userId, never taken from a client.

export type Db = SupabaseClient<Database>;

export type Fail = { ok: false; message: string; code?: ReaderImportErrorCode };
const GENERIC = "Something went wrong. Please try again.";

/** Placeholder title for a just-created import; prepare replaces it with the document's own title. */
export const IMPORT_PLACEHOLDER_TITLE = "Importing…";
/** A preparing/failed reader row older than this is an abandoned import and is swept on the next create. */
export const ABANDONED_IMPORT_MS = 60 * 60 * 1000;
export const DOC_URL_TTL_SECONDS = 60 * 60;

async function guard<T>(fn: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReaderInputError) return { ok: false, message: err.message };
    if (err instanceof ReaderImportError) return { ok: false, message: err.message, code: err.code };
    console.error("[reader]", err);
    return { ok: false, message: GENERIC };
  }
}

/** Removes every object in a book's reader folder (source.* and reader-v1.json). Best-effort. */
export async function removeReaderObjects(db: Db, userId: string, bookId: string): Promise<void> {
  const folder = readerFolder(userId, bookId);
  const { data } = await db.storage.from(BOOKS_BUCKET).list(folder, { limit: 100 });
  const names = (data ?? []).map((o) => `${folder}/${o.name}`);
  if (names.length) await db.storage.from(BOOKS_BUCKET).remove(names);
}

// ── create ───────────────────────────────────────────────────────────────────

export type CreateImportInput =
  | { kind: "file"; filename: string; fileSizeBytes: number; title?: string | null; author?: string | null }
  | { kind: "paste"; title?: string | null; author?: string | null }
  | { kind: "url"; url: string; title?: string | null; author?: string | null };

export type CreateImportResult =
  | { ok: true; bookId: string; upload: { path: string; token: string; contentType: string } | null }
  | Fail;

export async function createReaderImportCore(db: Db, userId: string, raw: unknown, now = new Date()): Promise<CreateImportResult> {
  return guard(async () => {
    const o = asObject(raw);
    const title = o.title ? parseTitle(o.title) : null;
    const author = parseAuthor(o.author);

    let source: ReaderSource;
    let sourceUrl: string | null = null;
    let ext: string | null = null;
    if (o.kind === "file") {
      if (typeof o.filename !== "string" || !o.filename.trim()) throw new ReaderInputError("Choose a file to import.");
      ext = sourceExtension(o.filename);
      if (!ext) throw new ReaderImportError("unsupported_type");
      if (typeof o.fileSizeBytes !== "number" || !(o.fileSizeBytes > 0)) throw new ReaderInputError("That file is empty.");
      if (o.fileSizeBytes > BOOK_MAX_BYTES) throw new ReaderInputError(BOOK_MAX_SIZE_MESSAGE);
      source = sourceKindForExtension(ext);
    } else if (o.kind === "paste") {
      ext = "txt";
      source = "paste";
    } else if (o.kind === "url") {
      if (typeof o.url !== "string") throw new ReaderInputError("Enter a link to import.");
      try {
        const parsed = parseImportUrl(o.url);
        // Early, friendly refusal of the obvious cases; the real guard is in fetchUrl's socket lookup.
        const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        if (host === "localhost" || host.endsWith(".localhost") || (isIP(host) && isBlockedAddress(host))) {
          throw new ReaderImportError("fetch_failed", "That link points at a private address, so it can't be imported.");
        }
        sourceUrl = parsed.toString();
      } catch (err) {
        throw toReaderImportError(err, "fetch_failed");
      }
      source = "url";
    } else {
      throw new ReaderInputError("That import type isn't valid.");
    }

    await sweepAbandonedImports(db, userId, now);

    const { data: inserted, error } = await db
      .from("books")
      .insert({
        user_id: userId,
        title: title ?? IMPORT_PLACEHOLDER_TITLE,
        author,
        // A reader-only book never goes through LLM ingestion: it is "ready" from the start with no
        // lessons and no ingestion_jobs row, so it can never appear in the ingestion banner.
        status: "ready",
        stage: "done",
        progress_pct: 100,
        ready_at: now.toISOString(),
        lesson_count: 0,
        ingestion_mode: "reader",
        reader_status: "preparing",
        reader_source: source,
        reader_source_url: sourceUrl,
        file_size_bytes: o.kind === "file" ? (o.fileSizeBytes as number) : null,
      })
      .select("id")
      .single();
    if (error || !inserted) throw error ?? new Error("insert returned no row");
    const bookId = inserted.id;

    if (!ext) return { ok: true, bookId, upload: null };

    const path = readerSourcePath(userId, bookId, ext);
    const { data: signed, error: signError } = await db.storage.from(BOOKS_BUCKET).createSignedUploadUrl(path);
    if (signError || !signed) {
      await db.from("books").delete().eq("id", bookId).eq("user_id", userId);
      throw signError ?? new Error("no signed url");
    }
    return { ok: true, bookId, upload: { path, token: signed.token, contentType: mimeForExtension(ext) } };
  });
}

async function sweepAbandonedImports(db: Db, userId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - ABANDONED_IMPORT_MS).toISOString();
  const { data } = await db
    .from("books")
    .select("id")
    .eq("user_id", userId)
    .eq("ingestion_mode", "reader")
    .in("reader_status", ["preparing", "failed"])
    .lt("created_at", cutoff)
    .limit(20);
  for (const row of data ?? []) {
    await removeReaderObjects(db, userId, row.id);
    await db.from("books").delete().eq("id", row.id).eq("user_id", userId);
  }
}

// ── prepare ──────────────────────────────────────────────────────────────────

export type PrepareResult = { ok: true; preview: ReaderImportPreview } | Fail;

interface BookForPrepare {
  id: string;
  title: string;
  author: string | null;
  file_path: string | null;
  reader_status: string;
  reader_source: string | null;
  reader_source_url: string | null;
  ingestion_mode: string;
}

/**
 * Builds + stores reader-v1.json for a book. Three shapes:
 *  - a fresh import (reader_status 'preparing'): reads source.<ext> from Storage (or fetches the URL);
 *  - an existing ingested PDF (reader_status 'none', file_path set): reads the original PDF — this is the
 *    lazy path that makes every library book readable;
 *  - already 'ready': returns the preview of the stored document without rebuilding.
 */
export async function prepareReaderDocCore(db: Db, userId: string, rawBookId: unknown): Promise<PrepareResult> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const { data: book } = await db
      .from("books")
      .select("id, title, author, file_path, reader_status, reader_source, reader_source_url, ingestion_mode")
      .eq("id", bookId)
      .eq("user_id", userId)
      .maybeSingle<BookForPrepare>();
    if (!book) throw new ReaderInputError("That book wasn't found.");

    if (book.reader_status === "ready") {
      const doc = await loadStoredDoc(db, userId, bookId);
      if (doc) return { ok: true, preview: makePreview(bookId, { doc, warnings: [] }) } as PrepareResult;
      // Marked ready but the document is gone (e.g. storage cleanup): rebuild below.
    }

    let result: ImportResult;
    try {
      result = await buildImport(db, userId, book);
    } catch (err) {
      const e = toReaderImportError(err);
      await db
        .from("books")
        .update({ reader_status: book.ingestion_mode === "reader" ? "failed" : "none", reader_error: e.message })
        .eq("id", bookId)
        .eq("user_id", userId);
      return { ok: false, message: e.message, code: e.code } as Fail;
    }

    const { doc } = result;
    const path = readerDocPath(userId, bookId);
    const body = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const { error: upErr } = await db.storage.from(BOOKS_BUCKET).upload(path, body, { upsert: true, contentType: "application/json" });
    if (upErr) throw upErr;

    const patch: Database["public"]["Tables"]["books"]["Update"] = {
      reader_status: "ready",
      reader_error: null,
      reader_word_count: doc.wordCount,
      reader_doc_version: READER_DOC_VERSION,
    };
    if (book.title === IMPORT_PLACEHOLDER_TITLE) patch.title = doc.title.slice(0, 200);
    if (!book.author && doc.author) patch.author = doc.author.slice(0, 200);
    if (book.ingestion_mode === "reader" && doc.source) patch.reader_source = doc.source;
    const { error: updErr } = await db.from("books").update(patch).eq("id", bookId).eq("user_id", userId);
    if (updErr) throw updErr;

    return { ok: true, preview: makePreview(bookId, result) } as PrepareResult;
  });
}

async function buildImport(db: Db, userId: string, book: BookForPrepare): Promise<ImportResult> {
  const names = { title: book.title === IMPORT_PLACEHOLDER_TITLE ? null : book.title, author: book.author };

  if (book.ingestion_mode === "reader" && book.reader_source === "url") {
    if (!book.reader_source_url) throw new ReaderImportError("fetch_failed");
    return importUrl(book.reader_source_url, names);
  }

  if (book.ingestion_mode === "reader") {
    const folder = readerFolder(userId, book.id);
    const { data: listed } = await db.storage.from(BOOKS_BUCKET).list(folder, { limit: 20 });
    const src = (listed ?? []).find((o) => o.name.startsWith("source."));
    if (!src) throw new ReaderImportError("empty", "The upload didn't arrive. Please try importing again.");
    const bytes = await download(db, `${folder}/${src.name}`);
    if (book.reader_source === "paste") {
      return importPaste(new TextDecoder("utf-8").decode(bytes), names);
    }
    return importFile({ bytes, filename: src.name, ...names });
  }

  // Existing ingested book. Prefer the original PDF (best paragraphs + outline), but the ingestion pipeline
  // DELETES it once a book is "ready" (book-pdf-gc.ts), so fall back to the text it kept: source_chunks.
  let fileError: unknown = null;
  if (book.file_path) {
    try {
      return await importFile({ bytes: await download(db, book.file_path), filename: book.file_path, ...names });
    } catch (err) {
      fileError = err;
    }
  }
  const stored = await loadStoredChunks(db, userId, book.id);
  if (stored.chunks.length > 0) return importChunks(stored.chunks, stored.sections, names);
  throw toReaderImportError(fileError ?? new ReaderImportError("empty", "This book has no text to read."), "empty");
}

const CHUNK_PAGE = 1000;

async function loadStoredChunks(db: Db, userId: string, bookId: string): Promise<{ chunks: ChunkInput[]; sections: SectionInput[] }> {
  const chunks: ChunkInput[] = [];
  for (let from = 0; ; from += CHUNK_PAGE) {
    const { data, error } = await db
      .from("source_chunks")
      .select("text, sort_order, section_id")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .order("sort_order", { ascending: true })
      .range(from, from + CHUNK_PAGE - 1);
    if (error) throw error;
    chunks.push(...(data ?? []));
    if ((data ?? []).length < CHUNK_PAGE) break;
  }
  const { data: sections } = await db.from("book_sections").select("id, title, sort_order").eq("user_id", userId).eq("book_id", bookId);
  return { chunks, sections: sections ?? [] };
}

async function download(db: Db, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(BOOKS_BUCKET).download(path);
  if (error || !data) throw new ReaderImportError("parse_failed", "That file couldn't be read. Please try again.");
  return new Uint8Array(await data.arrayBuffer());
}

async function loadStoredDoc(db: Db, userId: string, bookId: string): Promise<ReaderDoc | null> {
  const { data, error } = await db.storage.from(BOOKS_BUCKET).download(readerDocPath(userId, bookId));
  if (error || !data) return null;
  try {
    const doc = JSON.parse(await data.text()) as ReaderDoc;
    return doc.version === READER_DOC_VERSION ? doc : null;
  } catch {
    return null;
  }
}

// ── confirm / cancel / rename / delete ───────────────────────────────────────

export async function confirmReaderImportCore(db: Db, userId: string, rawBookId: unknown, rawEdits: unknown): Promise<{ ok: true } | Fail> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const edits = asObject(rawEdits);
    const title = parseTitle(edits.title);
    const author = parseAuthor(edits.author);
    const { data, error } = await db
      .from("books")
      .update({ title, author })
      .eq("id", bookId)
      .eq("user_id", userId)
      .eq("reader_status", "ready")
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ReaderInputError("That import isn't ready yet.");
    return { ok: true } as const;
  });
}

/** Deletes an import that never got confirmed. Only reader-only books that are not 'ready' can be cancelled this way. */
export async function cancelReaderImportCore(db: Db, userId: string, rawBookId: unknown, opts: { includeReady?: boolean } = {}): Promise<{ ok: true } | Fail> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const statuses = opts.includeReady ? ["preparing", "failed", "ready"] : ["preparing", "failed"];
    const { data } = await db
      .from("books")
      .select("id")
      .eq("id", bookId)
      .eq("user_id", userId)
      .eq("ingestion_mode", "reader")
      .in("reader_status", statuses)
      .maybeSingle();
    if (!data) return { ok: true } as const; // nothing to cancel (already gone, or not a reader import): safe no-op
    await removeReaderObjects(db, userId, bookId);
    await db.from("books").delete().eq("id", bookId).eq("user_id", userId);
    return { ok: true } as const;
  });
}

export async function renameBookCore(db: Db, userId: string, rawBookId: unknown, rawEdits: unknown): Promise<{ ok: true } | Fail> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const edits = asObject(rawEdits);
    const patch: { title: string; author?: string | null } = { title: parseTitle(edits.title) };
    if (edits.author !== undefined) patch.author = parseAuthor(edits.author);
    const { data, error } = await db.from("books").update(patch).eq("id", bookId).eq("user_id", userId).select("id");
    if (error) throw error;
    if (!data?.length) throw new ReaderInputError("That book wasn't found.");
    return { ok: true } as const;
  });
}

/**
 * Removes a book via the delete_book RPC (081: hard-delete when it has no review history, otherwise soft-delete
 * so provenance keeps resolving). Reader objects are removed on a hard delete only: a soft-deleted book can be
 * restored, and its reader document has to come back with it.
 */
export async function deleteBookCore(db: Db, userId: string, rawBookId: unknown): Promise<{ ok: true; hardDeleted: boolean } | Fail> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const { data, error } = await db.rpc("delete_book", { p_book_id: bookId });
    if (error) throw error;
    const result = (data ?? {}) as { hard_deleted?: boolean; storage_path?: string | null };
    const hardDeleted = result.hard_deleted === true;
    if (hardDeleted) {
      await removeReaderObjects(db, userId, bookId);
      if (result.storage_path) await db.storage.from(BOOKS_BUCKET).remove([result.storage_path]);
    }
    return { ok: true, hardDeleted } as const;
  });
}

// ── bootstrap ────────────────────────────────────────────────────────────────

export interface ReaderHighlight {
  id: string;
  bookId: string;
  startWord: number;
  endWord: number;
  text: string;
  note: string | null;
  createdAt: string;
}

export interface ReaderBootstrap {
  book: {
    id: string;
    title: string;
    author: string | null;
    readerStatus: string;
    wordCount: number | null;
    docVersion: number | null;
  };
  /** Short-lived signed URL of reader-v1.json; null while the document still has to be prepared. */
  docUrl: string | null;
  position: { wordIndex: number; wpm: number; clientUpdatedAt: string } | null;
  settings: ReaderSettings;
  highlights: ReaderHighlight[];
}

export async function getReaderBootstrapCore(db: Db, userId: string, rawBookId: unknown): Promise<{ ok: true; bootstrap: ReaderBootstrap } | Fail> {
  return guard(async () => {
    const bookId = parseUuid(rawBookId);
    const { data: book } = await db
      .from("books")
      .select("id, title, author, reader_status, reader_word_count, reader_doc_version")
      .eq("id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!book) throw new ReaderInputError("That book wasn't found.");

    let docUrl: string | null = null;
    if (book.reader_status === "ready") {
      const { data: signed } = await db.storage.from(BOOKS_BUCKET).createSignedUrl(readerDocPath(userId, bookId), DOC_URL_TTL_SECONDS);
      docUrl = signed?.signedUrl ?? null;
    }

    const [position, settings, highlights] = await Promise.all([
      db.from("reader_positions").select("word_index, wpm, client_updated_at").eq("user_id", userId).eq("book_id", bookId).maybeSingle(),
      loadReaderSettings(db, userId),
      listHighlightsRows(db, userId, bookId),
    ]);

    return {
      ok: true,
      bootstrap: {
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          readerStatus: book.reader_status,
          wordCount: book.reader_word_count,
          docVersion: book.reader_doc_version,
        },
        docUrl,
        position: position.data
          ? { wordIndex: position.data.word_index, wpm: position.data.wpm ?? settings.wpm, clientUpdatedAt: position.data.client_updated_at }
          : null,
        settings,
        highlights,
      },
    } as const;
  });
}

// ── position ─────────────────────────────────────────────────────────────────

export async function saveReaderPositionCore(db: Db, userId: string, raw: unknown, now = new Date()): Promise<{ ok: true; wordIndex: number } | Fail> {
  return guard(async () => {
    const p = parsePositionInput(raw, now);
    const { data: owned } = await db.from("books").select("id").eq("id", p.bookId).eq("user_id", userId).maybeSingle();
    if (!owned) throw new ReaderInputError("That book wasn't found.");
    const { data, error } = await db.rpc("reader_save_position", {
      p_book_id: p.bookId,
      p_word_index: p.wordIndex,
      p_wpm: p.wpm,
      p_client_updated_at: p.clientUpdatedAt.toISOString(),
    });
    if (error) throw error;
    return { ok: true, wordIndex: typeof data === "number" ? data : p.wordIndex } as const;
  });
}

// ── highlights ───────────────────────────────────────────────────────────────

async function listHighlightsRows(db: Db, userId: string, bookId: string | null): Promise<ReaderHighlight[]> {
  let q = db.from("reader_highlights").select("id, book_id, start_word, end_word, text, note, created_at").eq("user_id", userId);
  if (bookId) q = q.eq("book_id", bookId);
  const { data } = await q.order("start_word", { ascending: true }).order("created_at", { ascending: true }).limit(2000);
  return (data ?? []).map((h) => ({
    id: h.id,
    bookId: h.book_id,
    startWord: h.start_word,
    endWord: h.end_word,
    text: h.text,
    note: h.note,
    createdAt: h.created_at,
  }));
}

export async function createHighlightCore(db: Db, userId: string, raw: unknown): Promise<{ ok: true; highlight: ReaderHighlight } | Fail> {
  return guard(async () => {
    const h = parseHighlightInput(raw);
    const { data: book } = await db.from("books").select("id, reader_word_count").eq("id", h.bookId).eq("user_id", userId).maybeSingle();
    if (!book) throw new ReaderInputError("That book wasn't found.");
    if (book.reader_word_count != null && h.endWord >= book.reader_word_count) {
      throw new ReaderInputError("That highlight is outside the book.");
    }
    // The same passage highlighted twice (double-tap, retry) returns the existing one instead of stacking.
    // .limit(1), not .maybeSingle(): if a duplicate pair ever exists (no unique index), maybeSingle would error on it.
    const { data: dupes } = await db
      .from("reader_highlights")
      .select("id, book_id, start_word, end_word, text, note, created_at")
      .eq("user_id", userId)
      .eq("book_id", h.bookId)
      .eq("start_word", h.startWord)
      .eq("end_word", h.endWord)
      .order("created_at", { ascending: true })
      .limit(1);
    const dupe = dupes?.[0];
    if (dupe) return { ok: true, highlight: toHighlight(dupe) } as const;
    const { data, error } = await db
      .from("reader_highlights")
      .insert({ user_id: userId, book_id: h.bookId, start_word: h.startWord, end_word: h.endWord, text: h.text, note: h.note })
      .select("id, book_id, start_word, end_word, text, note, created_at")
      .single();
    if (error || !data) throw error ?? new Error("insert returned no row");
    return { ok: true, highlight: toHighlight(data) } as const;
  });
}

function toHighlight(h: { id: string; book_id: string; start_word: number; end_word: number; text: string; note: string | null; created_at: string }): ReaderHighlight {
  return { id: h.id, bookId: h.book_id, startWord: h.start_word, endWord: h.end_word, text: h.text, note: h.note, createdAt: h.created_at };
}

export async function deleteHighlightCore(db: Db, userId: string, rawId: unknown): Promise<{ ok: true } | Fail> {
  return guard(async () => {
    const id = parseUuid(rawId, "highlight");
    const { error } = await db.from("reader_highlights").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true } as const;
  });
}

export interface HighlightWithBook extends ReaderHighlight {
  bookTitle: string;
}

/** One book's highlights (bookId given) or every highlight across the library with its book title. */
export async function listHighlightsCore(db: Db, userId: string, rawBookId: unknown): Promise<{ ok: true; highlights: HighlightWithBook[] } | Fail> {
  return guard(async () => {
    const bookId = rawBookId == null ? null : parseUuid(rawBookId);
    const rows = await listHighlightsRows(db, userId, bookId);
    const ids = [...new Set(rows.map((r) => r.bookId))];
    const titles = new Map<string, string>();
    if (ids.length) {
      const { data } = await db.from("books").select("id, title").eq("user_id", userId).in("id", ids);
      for (const b of data ?? []) titles.set(b.id, b.title);
    }
    // Highlights of a soft-deleted book have no visible book row: they are hidden with it.
    const highlights = rows.filter((r) => titles.has(r.bookId)).map((r) => ({ ...r, bookTitle: titles.get(r.bookId) as string }));
    if (!bookId) highlights.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { ok: true, highlights } as const;
  });
}

// ── sessions + stats ─────────────────────────────────────────────────────────

export async function recordReaderSessionCore(db: Db, userId: string, timezone: string, raw: unknown, now = new Date()): Promise<{ ok: true; recorded: boolean } | Fail> {
  return guard(async () => {
    const s = parseSessionInput(raw, now);
    if (s.wordsRead === 0) return { ok: true, recorded: false } as const; // nothing read: not a session
    const { data: owned } = await db.from("books").select("id").eq("id", s.bookId).eq("user_id", userId).maybeSingle();
    if (!owned) throw new ReaderInputError("That book wasn't found.");
    // The client retries a stretch whose response it never saw: the same book and span is the same stretch.
    const { data: seen } = await db
      .from("reader_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("book_id", s.bookId)
      .eq("started_at", s.startedAt.toISOString())
      .eq("ended_at", s.endedAt.toISOString())
      .limit(1);
    if (seen?.length) return { ok: true, recorded: false } as const;
    const { error } = await db.from("reader_sessions").insert({
      user_id: userId,
      book_id: s.bookId,
      // The USER's local calendar day at the moment the stretch ended — never a UTC date.
      local_date: localDateString(s.endedAt, timezone),
      started_at: s.startedAt.toISOString(),
      ended_at: s.endedAt.toISOString(),
      words_read: s.wordsRead,
      mode: s.mode,
      avg_wpm: s.avgWpm,
    });
    if (error) throw error;
    return { ok: true, recorded: true } as const;
  });
}

export async function getReadingStatsCore(db: Db, userId: string, timezone: string, now = new Date()): Promise<{ ok: true; stats: ReadingStats } | Fail> {
  return guard(async () => {
    const today = localDateString(now, timezone);
    const since = localDateString(new Date(now.getTime() - STATS_WINDOW_DAYS * 86_400_000), timezone);
    const [{ data: rows, error }, settings] = await Promise.all([
      db.from("reader_sessions").select("local_date, words_read, avg_wpm").eq("user_id", userId).gte("local_date", since).order("local_date", { ascending: false }).limit(5000),
      loadReaderSettings(db, userId),
    ]);
    if (error) throw error;
    return { ok: true, stats: computeReadingStats(rows ?? [], settings.dailyWordGoal, today) } as const;
  });
}

// ── settings ─────────────────────────────────────────────────────────────────

const SETTINGS_COLUMNS =
  "reader_wpm, reader_font_scale, reader_theme, reader_voice_uri, reader_speech_rate, reader_focal_lines, reader_daily_word_goal";

export async function loadReaderSettings(db: Db, userId: string): Promise<ReaderSettings> {
  const { data } = await db.from("user_settings").select(SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (!data) return { ...DEFAULT_READER_SETTINGS };
  const d = DEFAULT_READER_SETTINGS;
  return {
    wpm: data.reader_wpm ?? d.wpm,
    fontScale: data.reader_font_scale == null ? d.fontScale : Number(data.reader_font_scale),
    theme: (data.reader_theme ?? d.theme) as ReaderSettings["theme"],
    voiceUri: data.reader_voice_uri ?? null,
    speechRate: data.reader_speech_rate == null ? d.speechRate : Number(data.reader_speech_rate),
    focalLines: data.reader_focal_lines ?? d.focalLines,
    dailyWordGoal: data.reader_daily_word_goal ?? null,
  };
}

export async function updateReaderSettingsCore(db: Db, userId: string, raw: unknown): Promise<{ ok: true; settings: ReaderSettings } | Fail> {
  return guard(async () => {
    const patch = parseSettingsPatch(raw);
    const row: Database["public"]["Tables"]["user_settings"]["Insert"] = { user_id: userId };
    if (patch.wpm !== undefined) row.reader_wpm = patch.wpm;
    if (patch.fontScale !== undefined) row.reader_font_scale = patch.fontScale;
    if (patch.theme !== undefined) row.reader_theme = patch.theme;
    if (patch.voiceUri !== undefined) row.reader_voice_uri = patch.voiceUri;
    if (patch.speechRate !== undefined) row.reader_speech_rate = patch.speechRate;
    if (patch.focalLines !== undefined) row.reader_focal_lines = patch.focalLines;
    if (patch.dailyWordGoal !== undefined) row.reader_daily_word_goal = patch.dailyWordGoal;
    const { error } = await db.from("user_settings").upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true, settings: await loadReaderSettings(db, userId) } as const;
  });
}
