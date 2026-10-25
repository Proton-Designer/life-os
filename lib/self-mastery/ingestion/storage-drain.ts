import type { SupabaseClient } from "@supabase/supabase-js";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";

/**
 * Empties the `pending_storage_deletions` queue (migration 075): paths of stored files that something wanted gone and could
 * not delete at the time (`book-pdf-gc` after a failed direct delete, `purge_user_data` for a deleted account). Nothing ever
 * drained it, so every one of those files was orphaned for good. The ingestion step route calls this once per poll, in the
 * same housekeeping slot as the stuck-book sweep.
 *
 * Bounded (DRAIN_LIMIT rows, oldest first, ONE storage call), idempotent (removing an object that is already gone is a
 * success in Storage, so its row is cleared; a second drain finds nothing) and never throws: a storage problem must cost a
 * poll nothing. A failed delete keeps its row, counts the attempt and records why; at `max_attempts` the row stops being
 * picked and stays in the table for a person to look at.
 *
 * The queue has no bucket column: every producer today writes `books` bucket paths (`<user_id>/<book_id>.<ext>`). A row whose
 * path is NOT under its own user's folder is never executed, it is parked (attempts = max) with a note: a queue row is data
 * a bug could have written, and this runs with the service role.
 */
export const DRAIN_LIMIT = 25;
const BOOKS_BUCKET = "books";
const DEFAULT_MAX_ATTEMPTS = 5; // the column default; rows are fetched below it, then re-checked against their own max

type QueueRow = { id: string; storage_path: string; user_id: string; attempts: number; max_attempts: number };
export type DrainResult = { deleted: number; failed: number; skipped: number };

export async function drainPendingStorageDeletions(supabase: SupabaseClient): Promise<DrainResult> {
  const result: DrainResult = { deleted: 0, failed: 0, skipped: 0 };
  try {
    const { data } = await untypedFrom(supabase, "pending_storage_deletions")
      .select("id, storage_path, user_id, attempts, max_attempts")
      .lt("attempts", DEFAULT_MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(DRAIN_LIMIT)
      .returns<QueueRow[]>();
    const rows = (data ?? []).filter((r) => r.attempts < r.max_attempts);
    if (rows.length === 0) return result;

    const runnable: QueueRow[] = [];
    for (const row of rows) {
      if (!row.storage_path.startsWith(`${row.user_id}/`) || row.storage_path.includes("..")) {
        await untypedFrom(supabase, "pending_storage_deletions")
          .update({ attempts: row.max_attempts, last_error: "parked: storage path is outside the owner's folder" })
          .eq("id", row.id);
        result.skipped += 1;
      } else {
        runnable.push(row);
      }
    }
    if (runnable.length === 0) return result;

    const { error } = await supabase.storage.from(BOOKS_BUCKET).remove(runnable.map((r) => r.storage_path));
    if (!error) {
      await untypedFrom(supabase, "pending_storage_deletions").delete().in("id", runnable.map((r) => r.id));
      result.deleted += runnable.length;
    } else {
      for (const row of runnable) {
        await untypedFrom(supabase, "pending_storage_deletions").update({ attempts: row.attempts + 1, last_error: error.message.slice(0, 500) }).eq("id", row.id);
      }
      result.failed += runnable.length;
    }
  } catch (e) {
    console.error("[self-mastery ingestion] pending-storage-deletions drain failed", e instanceof Error ? e.message : e);
  }
  return result;
}
