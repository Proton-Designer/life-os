import { computeHabitStreak } from "./habit-streak";

/**
 * Consecutive-day streak of "all 5 prayers logged on_time/qada" — reuses
 * computeHabitStreak's exact walk-back-from-today algorithm rather than
 * reimplementing it, since a qualifying day is just a completed-date set
 * once filtered. Relocated here from lib/home/ (Phase D) since prayer
 * streak is a Deen-domain concept Home just displays cross-cutting.
 */
export function computePrayerStreak(prayersByDate: Record<string, string[]>, todayStr: string): number {
  const qualifyingDates = Object.entries(prayersByDate)
    .filter(([, statuses]) => statuses.length >= 5 && statuses.every((s) => s === "on_time" || s === "qada"))
    .map(([date]) => date);
  return computeHabitStreak(qualifyingDates, todayStr);
}
