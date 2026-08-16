import type { ConsistencyRow } from "@/components/charts/consistency-grid";

export type HabitConsistencyHabit = { id: string; name: string; createdAt: string };
export type HabitConsistencyLog = { habitId: string; date: string; completed: boolean };

/**
 * Per-habit 30-day completion grid, same shape as Deen's prayer consistency
 * grid so ConsistencyGrid — including its min-cell-size + scroll-to-recent
 * fix (2026-08-16) — is reused unchanged rather than rebuilt.
 * "not_tracked" (an unstyled status, renders via ConsistencyGrid's own
 * muted fallback) covers both edges calculateWeeklyConsistency already
 * treats specially: days before the habit existed, and days after today.
 */
export function buildHabitConsistencyRows(
  habits: HabitConsistencyHabit[],
  logs: HabitConsistencyLog[],
  days: string[],
  todayStr: string
): ConsistencyRow[] {
  return habits.map((h) => ({
    label: h.name,
    cells: days.map((date) => {
      if (date < h.createdAt || date > todayStr) return { date, status: "not_tracked" };
      const log = logs.find((l) => l.habitId === h.id && l.date === date);
      return { date, status: log?.completed ? "done" : "missed" };
    }),
  }));
}
