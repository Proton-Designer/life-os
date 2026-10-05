import { computeHabitStreak } from "./habit-streak";
import { addDaysToDateString } from "@/lib/date-utils";
import type { AccentToken } from "@/lib/accent-tokens";

/**
 * Prayer streak = consecutive days on which ALL FIVE prayers were prayed ON TIME. A prayer made up later through Qada
 * does NOT qualify: the day it belonged to is broken (Ayman, 2026-10-05) — Qada is the repayment of a debt, not the
 * streak. Reuses computeHabitStreak's walk-back-from-today algorithm (a qualifying day is just a completed-date set once
 * filtered), so today being unfinished never breaks it. Relocated here from lib/home/ (Phase D).
 */
export const PRAYERS_PER_DAY = 5;

/** A day qualifies only if every one of its five prayers is on_time. */
export function isOnTimeDay(statuses: readonly string[]): boolean {
  return statuses.length >= PRAYERS_PER_DAY && statuses.every((s) => s === "on_time");
}

export function computePrayerStreak(prayersByDate: Record<string, string[]>, todayStr: string): number {
  const qualifyingDates = Object.entries(prayersByDate)
    .filter(([, statuses]) => isOnTimeDay(statuses))
    .map(([date]) => date);
  return computeHabitStreak(qualifyingDates, todayStr);
}

/**
 * The days on which all five prayers were on time, from raw `prayers` rows (any statuses; only on_time ones count, and
 * a day needs five DISTINCT prayer names so a duplicated row can't fake a full day). Sorted ascending.
 */
export function onTimeDaysFromRows(rows: ReadonlyArray<{ date: string; prayer_name: string; status: string }>): string[] {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.status !== "on_time") continue;
    const set = byDate.get(r.date) ?? new Set<string>();
    set.add(r.prayer_name);
    byDate.set(r.date, set);
  }
  return [...byDate.entries()]
    .filter(([, names]) => names.size >= PRAYERS_PER_DAY)
    .map(([date]) => date)
    .sort();
}

/** The longest run of consecutive calendar days in `onTimeDays` — the best streak ever recorded. 0 for none. */
export function computeLongestPrayerStreak(onTimeDays: readonly string[]): number {
  const days = [...new Set(onTimeDays)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && addDaysToDateString(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/**
 * Opus Lead review (2026-08-16): a KPI row where every card shares the
 * domain's own amber reads as one striped band, not three distinct facts.
 * Tint now follows the card's own value via the same positive/warning/
 * info/neutral vocabulary Badge already defines, not the domain accent.
 */
export function accentForPrayerStreak(streak: number): AccentToken {
  return streak > 0 ? "business" : "info";
}
