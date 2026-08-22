/**
 * This Week's per-day status — pure function, no React, no I/O.
 * docs/superpowers/plans/2026-08-22-fitness-system.md's logic-gap
 * resolution #3: the requirements name completed/active/upcoming only;
 * missed is the accountability-critical state and is added here.
 *
 * Callers only invoke this for a day that actually has scheduled items —
 * an empty day (nothing on the plan) has no status badge at all, which is
 * a caller-side "don't call this" decision, not something this function
 * needs to express.
 */
export type WeekDayStatus = "completed" | "active" | "upcoming" | "missed";

/**
 * Plain YYYY-MM-DD string comparison — lexicographic order matches
 * calendar order for this format, so no Date parsing is needed and a
 * malformed/empty string degrades gracefully (sorts before any real date)
 * rather than throwing.
 */
export function weekDayStatus(dateStr: string, todayStr: string, completed: boolean): WeekDayStatus {
  if (dateStr > todayStr) return "upcoming";
  if (dateStr === todayStr) return completed ? "completed" : "active";
  return completed ? "completed" : "missed";
}
