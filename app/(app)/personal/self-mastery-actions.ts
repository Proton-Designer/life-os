"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom, untypedRpc } from "@/lib/self-mastery/untyped-from";
import { isRetryableBookError, NO_KEY_MESSAGE } from "@/lib/self-mastery/ingestion/failure-messages";
import { lessonSourceKind, type LessonSourceKind } from "@/lib/self-mastery/ingestion/documents";
import { mimeForExtension, sourceKindForExtension } from "@/lib/reader/server/paths";
import { isIngestionAvailable, INGESTION_UNAVAILABLE_MESSAGE } from "@/lib/self-mastery/ingestion-availability";
import { hasUsableIngestionKey, ingestionNoKeyMessage } from "@/lib/ai/gateway";
import { BOOK_MAX_BYTES, BOOK_MAX_SIZE_MESSAGE } from "@/lib/self-mastery/book-upload-limits";

/**
 * The provenance drill-down's second block ("In context, from the book") —
 * live-fetched on open, never preloaded with the lesson list. Mirrors
 * ULM's own fetchSourceChunkText exactly: one column, one row, nothing
 * else about the chunk (embedding, token_count) leaves the server.
 */
export async function fetchSourceChunkText(sourceChunkId: string): Promise<string | null> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await untypedFrom(supabase, "source_chunks")
    .select("text")
    .eq("id", sourceChunkId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ text: string } | null>();
  if (error) throw error;
  return data?.text ?? null;
}

export interface UploadBookResult {
  ok: true;
  bookId: string;
}
export interface UploadBookError {
  ok: false;
  message: string;
}
export interface PrepareBookUploadResult {
  ok: true;
  bookId: string;
  path: string;
  token: string;
  /** The Content-Type the browser must upload with (the bucket only accepts the types in migration 269). */
  contentType: string;
}

/** What lesson ingestion accepts, by stored extension, with the Storage type the object must carry. */
const LESSON_SOURCES: Record<LessonSourceKind, { ext: string; mimeTypes: string[] }> = {
  pdf: { ext: "pdf", mimeTypes: ["application/pdf"] },
  epub: { ext: "epub", mimeTypes: ["application/epub+zip"] },
  txt: { ext: "txt", mimeTypes: ["text/plain"] },
  md: { ext: "md", mimeTypes: ["text/markdown", "text/plain"] },
};
const ALL_LESSON_PATH_EXTENSIONS = ["pdf", "epub", "txt", "md"] as const;
const UNSUPPORTED_BOOK_TYPE_MESSAGE = "That file type isn't supported. Upload a PDF, EPUB, TXT or Markdown file.";

/** The extension the book is STORED under, from the person's filename. null = not a type we accept. */
function storedExtensionFor(filename: string): LessonSourceKind | null {
  return lessonSourceKind(filename);
}

/**
 * Reads the first bytes of the stored object (a ranged GET on a short-lived signed URL) and checks they match what the
 * extension claims: %PDF, a zip (EPUB), or text with no NUL bytes. A file renamed to a type it is not is removed. If the
 * bytes cannot be fetched at all, this says "fine": the worker's own chunking stage re-validates the file and fails the
 * book with a specific message, so an unavailable sniff must never block a good upload.
 */
async function storedBytesMatch(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  path: string,
  kind: LessonSourceKind,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(BOOKS_BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return true;
    const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-4095" } });
    if (!res.ok) return true;
    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 4096);
    if (head.length === 0) return false;
    if (kind === "pdf") return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    if (kind === "epub") return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    return !head.includes(0);
  } catch {
    return true;
  }
}

const BOOKS_BUCKET = "books";
const GENERIC_UPLOAD_ERROR = "Something went wrong uploading that file. Please try again.";

/**
 * Step 1 of 2 (URGENT prod fix, 2026-09-19 -- BRIEF-pdf-upload.md): the old
 * single-action `uploadBook(formData)` sent the PDF bytes as part of the
 * Server Action's own request body. Next 16.3.5 hardcodes that body's
 * default cap at 1MB (verified in the INSTALLED package, not from memory --
 * node_modules/next/dist/server/app-render/action-handler.js:519), and
 * next.config.ts never raises `serverActions.bodySizeLimit`, so the runtime
 * rejected every book PDF over 1MB BEFORE this function ever ran --
 * `uploadBook` and its 200MB `validateBookFile` message could never be
 * reached for a real book, and the thrown rejection had no try/catch in
 * upload-book-dialog.tsx, so it rendered as the crash Ayman saw on
 * production. Same shape as school/lecture-actions.ts's
 * prepareLectureUpload/finalizeLectureUpload (P3-14): this mints a signed
 * UPLOAD url; the browser uploads straight to Storage (see
 * upload-book-dialog.tsx), so the PDF bytes never pass through a Server
 * Action's request body at all, then calls finalizeBookUpload below once
 * that succeeds.
 *
 * Every guard uploadBook used to run before touching `books` runs here
 * first, unchanged: driver-down, no usable key, no title. Size is checked
 * against BOOK_MAX_BYTES (50 MiB -- see that file's header for why 200MB
 * was never honest even before this bug: it's a project-wide Supabase
 * Storage account ceiling, not a Next/Vercel limit, so raising
 * bodySizeLimit alone would not have fixed this).
 */
export async function prepareBookUpload(
  title: string,
  author: string,
  ingestionMode: "standard" | "batch",
  fileSizeBytes: number,
  /** The picked file's name; only its extension is used (to choose the stored extension and Content-Type). Defaults to a PDF. */
  filename: string = "book.pdf",
): Promise<PrepareBookUploadResult | UploadBookError> {
  const { supabase, userId } = await requireUser();

  const sourceKind = storedExtensionFor(filename);
  if (!sourceKind) return { ok: false, message: UNSUPPORTED_BOOK_TYPE_MESSAGE };
  const sourceExt = LESSON_SOURCES[sourceKind].ext;

  // Refuse on the SERVER, not only by hiding the button. Without a worker to
  // consume `ingestion_jobs`, a successful upload strands the book at
  // "processing" forever with no failure path — so accepting the file is the
  // harm, and a hidden trigger is not a guard. See
  // lib/self-mastery/ingestion-availability.ts.
  if (!(await isIngestionAvailable())) return { ok: false, message: INGESTION_UNAVAILABLE_MESSAGE };

  // NO KEY CHECK HERE ANY MORE (2026-10-25, Ayman: "anyone can upload"). There is no shared key, so a user without their
  // own can still upload: the book is created and stays readable in the reader, and finalizeBookUpload marks it failed with
  // the retryable "add a key, then Try again" message instead of queueing a job that could never run.

  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { ok: false, message: "Give this book a title." };

  if (!(fileSizeBytes > 0)) return { ok: false, message: "That file is empty." };
  if (fileSizeBytes > BOOK_MAX_BYTES) return { ok: false, message: BOOK_MAX_SIZE_MESSAGE };

  // P2-14B: narrowed defensively, same posture as worker-stages.ts's own
  // getIngestionMode -- anything other than the literal "batch" degrades
  // to "standard" (the DB column's own default), never the other way
  // around. Set once here, at upload time; never changed mid-ingest
  // (migration 187's own header).
  const resolvedIngestionMode: "standard" | "batch" = ingestionMode === "batch" ? "batch" : "standard";

  const { data: inserted, error: insertError } = await untypedFrom(supabase, "books")
    .insert({
      user_id: userId,
      title: trimmedTitle,
      author: author.trim() || null,
      status: "uploading",
      stage: "queued",
      progress_pct: 0,
      file_size_bytes: fileSizeBytes,
      ingestion_mode: resolvedIngestionMode,
      // What the file is. Drives the library label and whether lessons carry real page numbers (only a PDF's do).
      reader_source: sourceKindForExtension(sourceExt),
    })
    .select("id")
    .single()
    .returns<{ id: string }>();
  if (insertError) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const bookId = inserted.id;
  const path = `${userId}/${bookId}.${sourceExt}`;

  const { data: signed, error: signError } = await supabase.storage.from(BOOKS_BUCKET).createSignedUploadUrl(path);
  if (signError) {
    // Same "delete the orphan row" posture uploadBook always had for a
    // failed upload -- just moved earlier, since minting the URL is now
    // the step that can fail before any bytes move.
    await untypedFrom(supabase, "books").delete().eq("id", bookId);
    return { ok: false, message: GENERIC_UPLOAD_ERROR };
  }

  return { ok: true, bookId, path, token: signed.token, contentType: mimeForExtension(sourceExt) };
}

/**
 * Step 2 of 2: called after the browser's own direct-to-Storage upload
 * succeeds. Never trusts anything the client claims about what it
 * uploaded — re-reads the real object from Storage (list, not the client's
 * File object) for its actual size/mime, same posture as
 * finalizeLectureUpload. Recomputes the expected path from THIS request's
 * own authenticated userId + the bookId argument rather than trusting the
 * client-supplied `path` outright: a mismatch means the caller is trying to
 * finalize an object it was never issued a signed-upload token for.
 * Requires the row to still be "uploading" — refuses to re-finalize a book
 * that's already past this step (double-submit, stale retry).
 *
 * Preserves everything uploadBook used to do after a successful upload:
 * flip to "processing", enqueue the `ingestion_jobs` row.
 */
export async function finalizeBookUpload(bookId: string, path: string): Promise<UploadBookResult | UploadBookError> {
  const { supabase, userId } = await requireUser();

  // The stored extension decides the format. The path is recomputed from THIS request's own user and book id, so a client
  // can neither point finalize at someone else's object nor smuggle in an extension we do not accept.
  const pathKind = lessonSourceKind(path);
  const sourceExt = pathKind ? LESSON_SOURCES[pathKind].ext : null;
  const expectedPath = `${userId}/${bookId}.${sourceExt}`;
  if (!pathKind || !sourceExt || path !== expectedPath) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const { data: bookRow, error: bookFetchError } = await untypedFrom(supabase, "books")
    .select("id, status")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ id: string; status: string } | null>();
  if (bookFetchError || !bookRow) return { ok: false, message: GENERIC_UPLOAD_ERROR };
  if (bookRow.status !== "uploading") return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const filename = `${bookId}.${sourceExt}`;
  const { data: listing, error: listError } = await supabase.storage.from(BOOKS_BUCKET).list(userId, { search: filename });
  if (listError) return { ok: false, message: GENERIC_UPLOAD_ERROR };
  const object = listing?.find((f) => f.name === filename);
  if (!object) return { ok: false, message: "Upload not found -- it may have failed or expired" };

  const metadata = object.metadata as { size?: number; mimetype?: string } | null;
  const sizeBytes = metadata?.size ?? 0;
  const mimeType = metadata?.mimetype ?? "application/octet-stream";
  // Belt-and-suspenders on top of the bucket's own policies (which already
  // gate WHO can write here, not what) -- doesn't assume the client-side
  // check in upload-book-dialog.tsx can never be bypassed. Type, size, then the
  // actual first bytes.
  if (!LESSON_SOURCES[pathKind].mimeTypes.includes(mimeType) || sizeBytes <= 0 || sizeBytes > BOOK_MAX_BYTES || !(await storedBytesMatch(supabase, path, pathKind))) {
    await supabase.storage.from(BOOKS_BUCKET).remove([path]);
    await untypedFrom(supabase, "books").delete().eq("id", bookId);
    return { ok: false, message: GENERIC_UPLOAD_ERROR };
  }

  // No usable key for this user's chosen provider: keep the book (and its PDF, so it is readable in the reader and a later
  // "Try again" has something to run), mark it failed with the retryable no-key message, and queue NO job. A queued job
  // with no key would only burn its attempts.
  const keyCheck = await hasUsableIngestionKey(supabase, userId);
  if (!keyCheck.usable) {
    const { error: noKeyError } = await untypedFrom(supabase, "books")
      .update({ file_path: path, status: "failed", error_message: NO_KEY_MESSAGE, file_size_bytes: sizeBytes })
      .eq("id", bookId);
    if (noKeyError) return { ok: false, message: GENERIC_UPLOAD_ERROR };
    revalidatePath("/personal/self_mastery");
    revalidatePath("/");
    return { ok: true, bookId };
  }

  const { error: updateError } = await untypedFrom(supabase, "books")
    .update({ file_path: path, status: "processing", file_size_bytes: sizeBytes })
    .eq("id", bookId);
  if (updateError) return { ok: false, message: GENERIC_UPLOAD_ERROR };

  const { error: jobError } = await untypedFrom(supabase, "ingestion_jobs").insert({
    book_id: bookId,
    user_id: userId,
    stage: "queued",
  });
  if (jobError) {
    // The row is already 'processing', and cancelBookUpload only cleans up 'uploading' rows, so leaving it would strand
    // a book with no job behind it forever. Take it back out the same way the failed-validation branch does.
    await supabase.storage.from(BOOKS_BUCKET).remove([path]);
    await untypedFrom(supabase, "books").delete().eq("id", bookId);
    return { ok: false, message: GENERIC_UPLOAD_ERROR };
  }

  revalidatePath("/personal/self_mastery");
  revalidatePath("/");
  return { ok: true, bookId };
}

/**
 * The new orphan risk the client-side upload hop introduces (URGENT
 * pdf-upload fix): prepareBookUpload now inserts the `books` row BEFORE
 * the file ever reaches Storage, so a failure between then and a
 * successful finalizeBookUpload — the direct-to-storage PUT itself
 * failing, the tab closing mid-upload, a network error calling finalize —
 * used to be impossible (the old uploadBook did the insert and the upload
 * in one atomic Server Action call) and is now a real path to a "books"
 * row stuck at status "uploading" forever, pointing at nothing. The client
 * calls this in every failure branch after prepareBookUpload succeeds (see
 * upload-book-dialog.tsx) so that never happens silently.
 *
 * Guarded by status = "uploading": if the row already progressed past that
 * (finalize already succeeded, or a concurrent call is mid-finalize), this
 * is a safe no-op rather than deleting a book that's actually fine.
 */
export async function cancelBookUpload(bookId: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: bookRow } = await untypedFrom(supabase, "books")
    .select("id, status")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ id: string; status: string } | null>();
  if (!bookRow || bookRow.status !== "uploading") return;

  // Whichever source file was uploaded: the extension is not stored until finalize, and removing a path that does not
  // exist is harmless.
  const paths = ALL_LESSON_PATH_EXTENSIONS.map((ext) => `${userId}/${bookId}.${ext}`);
  // Best-effort, same posture as removeLectureRecording: the row is the
  // source of truth for whether this book exists to the user, so a failure
  // removing a storage object that may never have been written (upload
  // failed before any bytes landed) is an orphaned object, not lost data.
  await supabase.storage.from(BOOKS_BUCKET).remove(paths);
  await untypedFrom(supabase, "books").delete().eq("id", bookId);
}

/**
 * "Try again" on a failed book: puts it back at the start of the queue through `retry_book_ingestion` (271), a
 * SECURITY DEFINER function that checks the caller owns the book (no service-role key here). Refuses first, on the server,
 * for what a retry cannot fix or cannot run: a failure about the file itself (scanned, password, damaged, too long: it
 * would fail the same way), the ingestion driver being down, or no usable AI key (the same two gates upload has, for the
 * same reason: a retry queued behind nothing would sit at "processing" forever).
 */
export async function retryBookIngestion(bookId: string): Promise<{ ok: true } | UploadBookError> {
  const { supabase, userId } = await requireUser();
  const cantRetry = "This book can't be retried.";

  const { data: book } = await untypedFrom(supabase, "books")
    .select("id, status, error_message")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<{ id: string; status: string; error_message: string | null } | null>();
  if (!book || book.status !== "failed") return { ok: false, message: cantRetry };
  if (!isRetryableBookError(book.error_message)) return { ok: false, message: book.error_message ?? cantRetry };

  if (!(await isIngestionAvailable())) return { ok: false, message: INGESTION_UNAVAILABLE_MESSAGE };
  const keyCheck = await hasUsableIngestionKey(supabase, userId);
  if (!keyCheck.usable) return { ok: false, message: ingestionNoKeyMessage(keyCheck.providerLabel) };

  const { data, error } = await untypedRpc<string>(supabase, "retry_book_ingestion", { p_book_id: bookId });
  if (error) return { ok: false, message: "Couldn't restart this book. Please try again." };
  if (data === "file_gone") return { ok: false, message: "The original file is no longer stored, so this book can't be run again. Upload it again." };
  if (data === "has_history") return { ok: false, message: "You've already studied or promoted lessons from this book, so it can't be rerun from scratch without losing that. Upload the file again as a new book." };
  if (data !== "retried") return { ok: false, message: cantRetry };

  revalidatePath("/personal/self_mastery");
  revalidatePath("/self-mastery");
  revalidatePath("/");
  return { ok: true };
}
