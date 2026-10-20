import "server-only";
import { prepareReaderDocCore, type Db } from "./core";

/** Longest the ingestion worker will wait for a reader build before moving on to deleting the PDF. */
export const READER_BUILD_BUDGET_MS = 25_000;

/**
 * Called by the ingestion pipeline right before it deletes a book's PDF (book-pdf-gc.ts): builds the reader
 * document from the original file while it still exists, so the best-quality text survives the deletion.
 * BEST-EFFORT BY CONTRACT: never throws, never waits longer than READER_BUILD_BUDGET_MS, and a failure only
 * means the reader later rebuilds from the stored text chunks instead (prepareReaderDocCore's fallback).
 * Ingestion must never fail or stall because of this.
 */
export async function buildReaderDocBeforeGc(db: Db, userId: string, bookId: string, budgetMs = READER_BUILD_BUDGET_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), budgetMs);
    });
    const outcome = await Promise.race([prepareReaderDocCore(db, userId, bookId), timeout]);
    if (outcome === "timeout") console.warn(`[reader] pre-GC build for book ${bookId} exceeded ${budgetMs} ms; continuing without it`);
    else if (!outcome.ok) console.warn(`[reader] pre-GC build for book ${bookId} failed: ${outcome.message}`);
  } catch (err) {
    console.error(`[reader] pre-GC build for book ${bookId} threw; continuing`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
