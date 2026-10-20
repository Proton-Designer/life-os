import { addDaysToDateString } from "@/lib/date-utils";

// Pure reading-stats math over reader_sessions rows. `today` is the user's local calendar date
// (localDateString(now, tz)) — never derived here from a Date, so the UTC-evening rollover can't leak in.

export interface SessionRow {
  local_date: string;
  words_read: number;
  avg_wpm: number | null;
}

export interface ReadingStats {
  today: string;
  todayWords: number;
  /** null = goal off */
  dailyWordGoal: number | null;
  goalMet: boolean;
  /** Consecutive local days that met the goal (or read anything, when there is no goal). */
  streak: number;
  /** Words-weighted average speed across the window, null when no session recorded one. */
  avgWpm: number | null;
  /** Oldest -> newest, the 7 days ending today. */
  last7: { date: string; words: number }[];
}

export const STATS_WINDOW_DAYS = 120;

export function computeReadingStats(rows: SessionRow[], dailyWordGoal: number | null, today: string): ReadingStats {
  const byDate = new Map<string, number>();
  let wpmWords = 0;
  let wpmSum = 0;
  for (const r of rows) {
    byDate.set(r.local_date, (byDate.get(r.local_date) ?? 0) + r.words_read);
    if (r.avg_wpm != null && r.words_read > 0) {
      wpmWords += r.words_read;
      wpmSum += r.words_read * r.avg_wpm;
    }
  }

  const threshold = dailyWordGoal ?? 1;
  const meets = (date: string) => (byDate.get(date) ?? 0) >= threshold;

  const todayWords = byDate.get(today) ?? 0;
  const goalMet = dailyWordGoal != null && todayWords >= dailyWordGoal;

  // Today not being done *yet* must not zero a streak: start counting from yesterday in that case.
  let cursor = meets(today) ? today : addDaysToDateString(today, -1);
  let streak = 0;
  while (meets(cursor) && streak <= STATS_WINDOW_DAYS) {
    streak += 1;
    cursor = addDaysToDateString(cursor, -1);
  }

  const last7: { date: string; words: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDaysToDateString(today, -i);
    last7.push({ date, words: byDate.get(date) ?? 0 });
  }

  return {
    today,
    todayWords,
    dailyWordGoal,
    goalMet,
    streak,
    avgWpm: wpmWords > 0 ? Math.round(wpmSum / wpmWords) : null,
    last7,
  };
}
