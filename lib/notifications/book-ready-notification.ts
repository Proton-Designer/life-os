import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "./send-push";

/**
 * #6's second half — "your book is ready" when ingestion completes. Opus
 * Lead ruling, 2026-09-14: GO. Migration 177 (book_ready_notification_log,
 * unique on `book_id` alone) is allocated to this track. This file is
 * fully within lib/notifications/**'s own ownership and ships as-is.
 *
 * THE ONE HOOK: `finalizingStage` in
 * lib/self-mastery/ingestion/worker-stages.ts, right after the `books` row
 * flips to `status: 'ready'`, before returning `nextStage: "done"`. Per
 * the lead's explicit authorization, this track may make EXACTLY that one
 * import + one call in that otherwise ULM-owned file — no other edit
 * there. NOT YET SHIPPED: held until the lead confirms migration 177 is
 * applied. The call must be NON-FATAL (the lead's own requirement): a book
 * becoming ready matters more than the notification about it, so the
 * caller wraps this in try/catch and continues on failure rather than
 * letting a push error fail or roll back the finalizing stage. This
 * function itself does not swallow its own errors — the caller's
 * try/catch is where that happens, kept there rather than here so a
 * caller that DOES want to observe a failure (a future admin/ops path)
 * still can.
 *
 * EXACTLY ONCE PER BOOK, ENFORCED BY `book_ready_notification_log_book_id_
 * key` (migration 177) — `unique (book_id)` alone, no date column: unlike
 * #10's due-card notification (a genuinely daily notion), a book only
 * ever finishes ingesting once.
 *
 * CLAIM-FIRST, THE SAME LOCKING SHAPE #10's due-card-notification.ts uses
 * (Opus Lead review of #10, 2026-09-14, generalized here on the same
 * instinct): this INSERTs the claim row BEFORE calling `sendPushToUser`,
 * using the unique index as the lock — not a check-then-send-then-record
 * read a genuinely concurrent retry of `finalizingStage` (a crash between
 * the `books` status UPDATE committing and the ingestion cursor advancing)
 * could race past. A `23505` on the claim means another call already
 * holds this book's one-time slot (a real prior send, or a concurrent
 * retry that won the race) — this call returns without ever touching
 * `sendPushToUser`. If nothing sendable turns up after claiming (the book
 * row can't be read) or delivery fully fails (`delivered: 0`), the claim
 * row is DELETEd so a genuine retry of the SAME book can still notify once
 * it actually succeeds.
 *
 * Deep-links to `/self-mastery/${bookId}` (app/(app)/self-mastery/
 * [bookId]/page.tsx) — that book's own detail page, not Home, since this
 * notification is specifically ABOUT one book, unlike #10's due-card push
 * which has no single book to point at.
 */

interface BookRow {
  title: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/** Attempts to claim `book_id` — true if THIS call won it, false if it was already claimed (a real prior send, or a genuinely concurrent finalizingStage retry). */
async function claimBookNotification(supabase: SupabaseClient, userId: string, bookId: string): Promise<boolean> {
  const { error } = await supabase.from("book_ready_notification_log").insert({ user_id: userId, book_id: bookId });
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return true;
}

/** Releases a claim this call itself just won, after determining nothing was actually sent — safe unconditionally: only the winner of claimBookNotification ever reaches here for this book_id. */
async function releaseBookNotification(supabase: SupabaseClient, bookId: string): Promise<void> {
  const { error } = await supabase.from("book_ready_notification_log").delete().eq("book_id", bookId);
  if (error) throw error;
}

export async function notifyBookReady(supabase: SupabaseClient, userId: string, bookId: string): Promise<void> {
  // THE LOCK: claim this book's one-time slot before doing anything else
  // that could race. A false return means someone else already holds it —
  // skip without ever calling sendPushToUser.
  if (!(await claimBookNotification(supabase, userId, bookId))) return;

  const { data: book, error: bookError } = await supabase.from("books").select("title").eq("id", bookId).eq("user_id", userId).maybeSingle();
  if (bookError) throw bookError;
  if (!book) {
    await releaseBookNotification(supabase, bookId); // nothing honest to name -- release for a later retry
    return;
  }

  const title = "Your book is ready";
  const body = `"${(book as BookRow).title}" is ready to study`;
  const result = await sendPushToUser(supabase, userId, title, body, `/self-mastery/${bookId}`);
  if (result.delivered === 0) {
    await releaseBookNotification(supabase, bookId);
  }
}
