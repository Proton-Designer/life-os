/**
 * BRIEF-pdf-gc.md: delete a book's uploaded PDF once ingestion has
 * genuinely finished with it. Storage cost is real -- ~50MB/book against a
 * 1GB free-tier ceiling is ~20 books across every user -- and the file is a
 * TRANSIENT INPUT, not durable data: only `chunkingStage` (worker-stages.ts)
 * ever downloads it, it extracts text into `source_chunks`, and every later
 * stage (embedding, extraction, merging, grounding, card generation) reads
 * those rows instead. No viewer, no PDF-citation feature reads it back, and
 * `file_path` is deliberately excluded from the MCP read surface.
 *
 * CALL SITE IS THE WHOLE SAFETY ARGUMENT, NOT THIS FILE'S OWN LOGIC. This
 * function is only ever meant to be invoked from `finalizingStage`'s
 * already-ready branch (worker-stages.ts) -- the pipeline's own literal
 * terminal-success state (`books.status` -> `'ready'`), reached only after
 * chunking, embedding, extraction, merging, grounding and card generation
 * have ALL already completed. Calling this any earlier (e.g. right after
 * `chunkingStage` itself returns) would be wrong even though nothing LATER
 * in the pipeline reads the file: `chunkingStage` re-downloads and
 * re-parses the PDF from scratch on its OWN retry (its handler covers
 * `queued`/`extracting_text`/`parsing_structure`/`chunking` alike), and a
 * crash between that stage returning success and the DB durably advancing
 * past it would otherwise re-invoke it against an already-deleted file --
 * turning a recoverable failure into a permanent one. `finalizingStage`
 * reaching its ready branch means every one of those stages, including
 * chunking's own retry window, is already behind the job.
 *
 * THE SANCTIONED DELETION PATH (migration 081's `pending_storage_deletions`
 * + `confirm_storage_deleted`) IS HALF-BUILT: nothing in this codebase
 * sweeps that queue today (grepped, confirmed -- see
 * .brain/memory/known-issues.md). Enqueuing alone deletes nothing, so this
 * deletes the Storage object DIRECTLY and only falls back to enqueuing (for
 * a future sweep that does not exist yet) when the direct delete itself
 * fails, matching the table's stated purpose of "the file's row is gone but
 * the object might not be yet" rather than routing every deletion through a
 * queue nothing drains.
 *
 * NEVER THROWS. A book that ingested fine and failed to GC its PDF is a
 * storage problem to clean up later; a book that ingested fine and got
 * marked failed because GC threw would be a data problem this file must
 * never cause -- same posture as `completeOnboarding`'s swallow-and-log
 * around starter-deck seeding.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const BOOKS_BUCKET = "books";

/**
 * Flag-controlled, not hardcoded: default ON (matches Ayman's approval to
 * ship this now), but a single env var flip disables it with no migration
 * and no redeploy of any changed logic -- the check is read fresh on every
 * call, not baked into a build. Set to the literal string "false" to
 * disable; any other value (including unset) leaves GC enabled.
 */
export function isBookPdfGcEnabled(): boolean {
  return process.env.SELF_MASTERY_GC_BOOK_PDF !== "false";
}

export interface BookPdfGcTarget {
  bookId: string;
  userId: string;
  filePath: string;
}

/**
 * Deletes `filePath` from the `books` Storage bucket and nulls
 * `books.file_path`, or -- if the flag is off, the path is already gone
 * from the row, or the delete itself fails -- leaves the row exactly as it
 * was and, on a genuine delete failure, records the path in
 * `pending_storage_deletions` so the gap is visible rather than silently
 * losing track of an orphaned file. Never throws.
 */
export async function gcBookPdfAfterIngestion(supabase: SupabaseClient<Database>, target: BookPdfGcTarget): Promise<void> {
  if (!isBookPdfGcEnabled()) return;

  const { bookId, userId, filePath } = target;

  try {
    const { error: removeError } = await supabase.storage.from(BOOKS_BUCKET).remove([filePath]);
    if (removeError) throw removeError;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`book-pdf-gc: Storage delete failed for book ${bookId} (${filePath}), enqueuing for a future sweep:`, err);
    const { error: enqueueError } = await supabase
      .from("pending_storage_deletions")
      .insert({ storage_path: filePath, user_id: userId, last_error: message });
    if (enqueueError) {
      console.error(`book-pdf-gc: ALSO failed to enqueue pending_storage_deletions for book ${bookId}:`, enqueueError);
    }
    // `file_path` is left untouched -- the object may still exist, so the
    // row must keep claiming it rather than silently forgetting where it is.
    return;
  }

  const { error: nullError } = await supabase.from("books").update({ file_path: null }).eq("id", bookId);
  if (nullError) {
    console.error(`book-pdf-gc: Storage object for book ${bookId} was deleted but file_path could not be nulled:`, nullError);
  }
}
