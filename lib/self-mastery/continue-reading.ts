import "server-only";
import { getProfile, requireUser } from "@/lib/supabase/auth";
import { getReadingStatsCore, type Db } from "@/lib/reader/server/core";

export interface ContinueReading {
  bookId: string;
  title: string;
  /** 0-100, null when the book's word count is unknown. */
  progressPct: number | null;
  todayWords: number;
  dailyWordGoal: number | null;
  streak: number;
}

/**
 * Home's "Continue reading" entry: the book the person last read (newest bookmark), how far they are, and today's words
 * against the daily goal. null when they have never read anything in the reader, or that book is gone / still being
 * prepared. Plain reads of tables the reader already owns - no new queries beyond the bookmark and the book row.
 */
export async function getContinueReadingCore(db: Db, userId: string, timezone: string, now = new Date()): Promise<ContinueReading | null> {
  const { data: pos } = await db
    .from("reader_positions")
    .select("book_id, word_index, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pos) return null;
  const { data: book } = await db
    .from("books")
    .select("id, title, reader_status, reader_word_count")
    .eq("user_id", userId)
    .eq("id", pos.book_id)
    .maybeSingle();
  if (!book || book.reader_status !== "ready") return null;
  const total = book.reader_word_count ?? 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((pos.word_index / total) * 100)) : null;
  const stats = await getReadingStatsCore(db, userId, timezone, now);
  return {
    bookId: book.id,
    title: book.title,
    progressPct,
    todayWords: stats.ok ? stats.stats.todayWords : 0,
    dailyWordGoal: stats.ok ? stats.stats.dailyWordGoal : null,
    streak: stats.ok ? stats.stats.streak : 0,
  };
}

export async function getContinueReading(): Promise<ContinueReading | null> {
  try {
    const { supabase, userId } = await requireUser();
    const timezone = (await getProfile())?.timezone ?? "UTC";
    return await getContinueReadingCore(supabase, userId, timezone);
  } catch (err) {
    // Home must never break because of the reader.
    console.warn("[self-mastery] getContinueReading failed; hiding the card", err);
    return null;
  }
}
