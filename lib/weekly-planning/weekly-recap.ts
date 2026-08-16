import { addDaysToDateString } from "@/lib/date-utils";

export type WeekWindow = { weekStart: string; label: string };
export type RecapPrayerRow = { date: string; status: string };
export type RecapAdhkarRow = { date: string; completed: boolean };
export type RecapQuranRow = { date: string; pages_read: number };

export type WeekRecap = {
  label: string;
  prayersOnTime: number;
  adhkarDone: number;
  quranPages: number;
};

/**
 * Buckets prayers/adhkar/Qur'an history into per-week recap numbers — a
 * single bulk range query per table over the whole window, sliced in
 * memory per week, per the data-layer convention (never a loop of a
 * per-week helper). Feeds both the recap tiles' sparklines and the
 * week-over-week small multiples at the bottom of Weekly Planning.
 */
export function buildWeeklyRecap(
  prayerRows: RecapPrayerRow[],
  adhkarRows: RecapAdhkarRow[],
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
      adhkarDone: adhkarRows.filter((r) => inWeek(r.date) && r.completed).length,
      quranPages: quranRows.filter((r) => inWeek(r.date)).reduce((sum, r) => sum + r.pages_read, 0),
    };
  });
}
