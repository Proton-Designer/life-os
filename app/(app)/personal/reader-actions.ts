"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import {
  cancelReaderImportCore,
  confirmReaderImportCore,
  createHighlightCore,
  createReaderImportCore,
  deleteBookCore,
  deleteHighlightCore,
  getReaderBootstrapCore,
  getReadingStatsCore,
  listHighlightsCore,
  prepareReaderDocCore,
  recordReaderSessionCore,
  renameBookCore,
  saveReaderPositionCore,
  updateReaderSettingsCore,
} from "@/lib/reader/server/core";

// Thin "use server" wrappers: auth + revalidation here, all logic in lib/reader/server/core.ts (testable
// without a request). Every action takes plain serializable arguments and returns { ok } | { ok:false, message }
// — expected failures are values, not thrown errors, so the client can show the message.
//
// The reader NEVER goes through prepareBookUpload (which needs the ingestion driver + an AI key): a reader
// import is "ready" the moment its document is built. See DESIGN.md §0.

function refreshLibrary() {
  revalidatePath("/personal/self_mastery");
  revalidatePath("/");
}

/** Step 1 of an import. file → signed upload to Storage (then call prepareReaderDoc); paste → same, with the text uploaded as source.txt; url → no upload. */
export async function createReaderImport(input: unknown) {
  const { supabase, userId } = await requireUser();
  return createReaderImportCore(supabase, userId, input);
}

/** Step 2: builds + stores the reader document and returns the preview. Also the lazy path for already-ingested PDF books. */
export async function prepareReaderDoc(bookId: string) {
  const { supabase, userId } = await requireUser();
  const result = await prepareReaderDocCore(supabase, userId, bookId);
  if (result.ok) refreshLibrary();
  return result;
}

/** Step 3: the person accepted the preview (optionally with an edited title/author). */
export async function confirmReaderImport(bookId: string, edits: { title: string; author?: string | null }) {
  const { supabase, userId } = await requireUser();
  const result = await confirmReaderImportCore(supabase, userId, bookId, edits);
  if (result.ok) refreshLibrary();
  return result;
}

/** Abandons an import (failed upload, rejected preview): removes the row and its objects. A no-op for anything else. */
export async function cancelReaderImport(bookId: string) {
  const { supabase, userId } = await requireUser();
  const result = await cancelReaderImportCore(supabase, userId, bookId, { includeReady: true });
  refreshLibrary();
  return result;
}

export async function renameBook(bookId: string, edits: { title: string; author?: string | null }) {
  const { supabase, userId } = await requireUser();
  const result = await renameBookCore(supabase, userId, bookId, edits);
  if (result.ok) refreshLibrary();
  return result;
}

export async function deleteBook(bookId: string) {
  const { supabase, userId } = await requireUser();
  const result = await deleteBookCore(supabase, userId, bookId);
  if (result.ok) refreshLibrary();
  return result;
}

/** Everything the reader needs to open a book: metadata, signed document URL, bookmark, settings, highlights. */
export async function getReaderBootstrap(bookId: string) {
  const { supabase, userId } = await requireUser();
  return getReaderBootstrapCore(supabase, userId, bookId);
}

/** Bookmark write (newest client timestamp wins). The unload path uses POST /api/reader/position instead. */
export async function saveReaderPosition(input: unknown) {
  const { supabase, userId } = await requireUser();
  return saveReaderPositionCore(supabase, userId, input);
}

export async function createHighlight(input: unknown) {
  const { supabase, userId } = await requireUser();
  return createHighlightCore(supabase, userId, input);
}

export async function deleteHighlight(highlightId: string) {
  const { supabase, userId } = await requireUser();
  return deleteHighlightCore(supabase, userId, highlightId);
}

/** One book's highlights (bookId) or every highlight in the library (null), newest first. */
export async function listHighlights(bookId: string | null) {
  const { supabase, userId } = await requireUser();
  return listHighlightsCore(supabase, userId, bookId);
}

/** Written on pause/close: one reading stretch. Feeds the daily goal, streak and average speed. */
export async function recordReaderSession(input: unknown) {
  const { supabase, userId } = await requireUser();
  const timezone = (await getProfile())?.timezone ?? "UTC";
  return recordReaderSessionCore(supabase, userId, timezone, input);
}

export async function getReadingStats() {
  const { supabase, userId } = await requireUser();
  const timezone = (await getProfile())?.timezone ?? "UTC";
  return getReadingStatsCore(supabase, userId, timezone);
}

export async function updateReaderSettings(patch: unknown) {
  const { supabase, userId } = await requireUser();
  return updateReaderSettingsCore(supabase, userId, patch);
}
