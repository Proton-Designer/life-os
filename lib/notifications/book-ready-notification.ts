import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "./send-push";

/**
 * #6's second half — "your book is ready" when ingestion completes.
 *
 * PROPOSED, NOT YET WIRED IN: this file is fully within this track's own
 * lib/notifications/** ownership and can ship as-is, but the ONE call site
 * that would actually invoke it — `finalizingStage` in
 * lib/self-mastery/ingestion/worker-stages.ts (~line 663, right after the
 * `books` row flips to `status: 'ready'`) — belongs to the ULM engineer's
 * area. Per the Opus Lead's instruction: propose the hook, don't edit that
 * file. The proposed addition there is exactly one line plus an import:
 *
 *   import { notifyBookReady } from "@/lib/notifications/book-ready-notification";
 *   ...
 *   const { error: updateError } = await ctx.supabase
 *     .from("books")
 *     .update({ status: "ready", ready_at: new Date().toISOString(), progress_pct: 100, lesson_count: count })
 *     .eq("id", ctx.job.book_id);
 *   if (updateError) throw updateError;
 *
 *   await notifyBookReady(ctx.supabase, ctx.job.user_id, ctx.job.book_id);  // <-- the proposed line
 *
 *   return { nextStage: "done", nextChunkIndex: null };
 *
 * `ctx.job.user_id`/`ctx.job.book_id` are already present on `StageContext`
 * (confirmed by reading worker-stages.ts — every other stage in that file
 * already reads both off `ctx.job` the same way).
 *
 * EXACTLY ONCE PER BOOK, ENFORCED BY A DB UNIQUENESS (`book_ready_
 * notification_log`, proposed as a NEW migration — no number allocated
 * yet, deliberately not written as a migration file until the lead/ULM
 * engineer confirm this design), keyed on `book_id` ALONE (not a date —
 * unlike #10's due-card notification, a book only ever finishes ingesting
 * once, so there is no "daily" dimension here at all). CHECK-THEN-SEND-
 * THEN-RECORD, the same order and reasoning as #10's
 * due-card-notification.ts and notify-core.ts's sendScheduledNotificationCore:
 * the log row is written ONLY after a real send succeeds to at least one
 * device, so a transient push failure doesn't permanently mark a book
 * "already notified" with nobody ever actually told. This also makes the
 * hook SAFE AGAINST A CRASH-RETRY of finalizingStage itself (the same
 * "terminal on first occurrence" stage could theoretically re-run its side
 * effects if a crash happened after the books UPDATE committed but before
 * the ingestion cursor advanced) — a second call finds the log row (or,
 * before that exists, the fact that the previous call's send already
 * delivered) and no-ops rather than double-notifying.
 *
 * Deep-links to `/self-mastery/${bookId}` (app/(app)/self-mastery/
 * [bookId]/page.tsx) — that book's own detail page, not Home, since this
 * notification is specifically ABOUT one book, unlike #10's due-card push
 * which has no single book to point at.
 */

interface BookRow {
  title: string;
}

async function alreadyNotifiedForBook(supabase: SupabaseClient, bookId: string): Promise<boolean> {
  const { data, error } = await supabase.from("book_ready_notification_log").select("id").eq("book_id", bookId).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markNotifiedForBook(supabase: SupabaseClient, userId: string, bookId: string): Promise<void> {
  const { error } = await supabase.from("book_ready_notification_log").insert({ user_id: userId, book_id: bookId });
  // 23505 means a genuinely concurrent finalizingStage retry already
  // recorded this book (the crash-retry case this file's own header
  // names) -- the push already happened either way, nothing more to record.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function notifyBookReady(supabase: SupabaseClient, userId: string, bookId: string): Promise<void> {
  if (await alreadyNotifiedForBook(supabase, bookId)) return;

  const { data: book, error: bookError } = await supabase.from("books").select("title").eq("id", bookId).eq("user_id", userId).maybeSingle();
  if (bookError) throw bookError;
  if (!book) return; // nothing honest to name -- don't send a titleless push

  const title = "Your book is ready";
  const body = `"${(book as BookRow).title}" is ready to study`;
  const result = await sendPushToUser(supabase, userId, title, body, `/self-mastery/${bookId}`);
  if (result.delivered > 0) {
    await markNotifiedForBook(supabase, userId, bookId);
  }
}
