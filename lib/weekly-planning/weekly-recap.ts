import { addDaysToDateString } from "@/lib/date-utils";
import { countDaysCleared } from "@/lib/business/kill-list-cleared";

export type WeekWindow = { weekStart: string; label: string };
export type RecapPrayerRow = { date: string; status: string };
export type RecapKillListRow = { date: string; completed: boolean };
export type RecapQuranRow = { date: string; pages_read: number };

export type WeekRecap = {
  label: string;
  prayersOnTime: number;
  killListDaysCleared: number;
  quranPages: number;
};

/**
 * Buckets prayers/kill-list/Qur'an history into per-week recap numbers — a
 * single bulk range query per table over the whole window, sliced in
 * memory per week, per the data-layer convention (never a loop of a
 * per-week helper — countDaysCleared itself runs once per week here, but
 * that's pure in-memory work over already-fetched rows, not a query).
 * Feeds both the recap tiles' sparklines and the week-over-week small
 * multiples at the bottom of Weekly Planning.
 *
 * Opus Lead review (2026-08-16): this recap originally showed Adhkar, but
 * adhkar was removed from the Deen UI on 2026-08-15 — a headline metric
 * for a feature that no longer exists would read 0/14 forever. Replaced
 * with kill-list days cleared (reuses countDaysCleared from Phase E),
 * which also balances the recap across Deen and Business instead of
 * three Deen tiles and one Business. Reflection is deliberately excluded
 * from any recap/review/aggregate — privacy is absolute, not just a UI
 * convention.
 */
export function buildWeeklyRecap(
  prayerRows: RecapPrayerRow[],
  killListRows: RecapKillListRow[],
  quranRows: RecapQuranRow[],
  weeks: WeekWindow[]
): WeekRecap[] {
  return weeks.map((w) => {
    const weekEnd = addDaysToDateString(w.weekStart, 7);
    const inWeek = (date: string) => date >= w.weekStart && date < weekEnd;
    return {
      label: w.label,
      prayersOnTime: prayerRows.filter((r) => inWeek(r.date) && (r.status === "on_time" || r.status === "qada"))
        .length,
      killListDaysCleared: countDaysCleared(killListRows.filter((r) => inWeek(r.date))),
      quranPages: quranRows.filter((r) => inWeek(r.date)).reduce((sum, r) => sum + r.pages_read, 0),
    };
  });
}
