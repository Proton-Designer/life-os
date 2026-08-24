import { dayWeight, bucketForWeight, type ReflectionDayBucket, type ReflectionTierEntry } from "./reflection-strip";

/** "empty" is distinct from "clear" — a future day hasn't happened yet, so it
 * hasn't earned a clean verdict the way a completed zero-weight day has
 * (spec 2026-08-23 §7). Padding cells from the adjacent month reuse it too,
 * since they carry no data for this grid. */
export type ReflectionMonthBucket = ReflectionDayBucket | "empty";

export type ReflectionMonthDay = {
  date: string;
  /** False for the leading/trailing days that pad the grid out to full weeks. */
  inMonth: boolean;
  isToday: boolean;
  weight: number;
  bucket: ReflectionMonthBucket;
  counts: { light: number; moderate: number; heavy: number };
};

/**
 * A full calendar-month grid (Sun-first, padded to complete weeks) for the
 * given year/month (1-12). Reuses dayWeight/bucketForWeight from
 * reflection-strip.ts rather than a second intensity scale, and preserves
 * that module's "today isn't over yet" rule: an empty in-progress today is
 * never painted "clear".
 */
export function buildReflectionMonth(
  entries: ReflectionTierEntry[],
  year: number,
  month: number,
  todayStr: string
): ReflectionMonthDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year, month, 0));

  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const entriesByDate = new Map<string, { tier: 1 | 2 | 3 }[]>();
  for (const entry of entries) {
    const list = entriesByDate.get(entry.date) ?? [];
    list.push(entry);
    entriesByDate.set(entry.date, list);
  }

  const days: ReflectionMonthDay[] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const inMonth = cursor.getUTCFullYear() === year && cursor.getUTCMonth() === month - 1;

    if (!inMonth) {
      days.push({
        date: dateStr,
        inMonth: false,
        isToday: false,
        weight: 0,
        bucket: "empty",
        counts: { light: 0, moderate: 0, heavy: 0 },
      });
    } else {
      const isToday = dateStr === todayStr;
      const dayEntries = entriesByDate.get(dateStr) ?? [];
      const weight = dayWeight(dayEntries);
      const counts = {
        light: dayEntries.filter((e) => e.tier === 1).length,
        moderate: dayEntries.filter((e) => e.tier === 2).length,
        heavy: dayEntries.filter((e) => e.tier === 3).length,
      };

      let bucket: ReflectionMonthBucket;
      if (dateStr > todayStr) {
        bucket = "empty";
      } else if (isToday && weight === 0) {
        bucket = "in_progress";
      } else {
        bucket = bucketForWeight(weight);
      }

      days.push({ date: dateStr, inMonth: true, isToday, weight, bucket, counts });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}
