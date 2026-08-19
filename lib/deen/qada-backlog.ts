import { PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import type { ResolvedDayStatuses } from "./prayer-status";

export type QadaBacklogItem = { date: string; prayer: PrayerName };

/**
 * The real, itemized backlog — every (date, prayer) since the floor whose
 * effective status is `missed`. Most recent date first, and Fajr..Isha
 * order within a date. Purely a read of already-resolved statuses; this
 * never touches `profiles.qada_owed` (the legacy pre-app debt, see
 * totalQadaOwed) and never writes anything.
 */
export function buildQadaBacklog(resolved: Record<string, ResolvedDayStatuses>): {
  items: QadaBacklogItem[];
  derivedCount: number;
} {
  const items: QadaBacklogItem[] = [];
  for (const date of Object.keys(resolved)) {
    for (const prayer of PRAYER_NAMES) {
      if (resolved[date][prayer] === "missed") {
        items.push({ date, prayer });
      }
    }
  }
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return PRAYER_NAMES.indexOf(a.prayer) - PRAYER_NAMES.indexOf(b.prayer);
  });
  return { items, derivedCount: items.length };
}

/** Displayed total = legacy pre-app debt (untouched, hand-tracked) + the derived backlog count. */
export function totalQadaOwed(legacyOwed: number, derivedCount: number): number {
  return legacyOwed + derivedCount;
}

export type QadaBacklogBuckets = {
  /** date >= sevenDaysAgoStr */
  last7: QadaBacklogItem[];
  /** thirtyDaysAgoStr <= date < sevenDaysAgoStr */
  month: QadaBacklogItem[];
  /** date < thirtyDaysAgoStr (within whatever window `items` covers) */
  older: QadaBacklogItem[];
};

/**
 * Splits an already most-recent-first `items` list (see buildQadaBacklog)
 * into three non-overlapping, time-ordered buckets for the backlog
 * sub-window's sectioned display — each bucket stays latest-to-oldest since
 * that ordering is just inherited from the input, never re-sorted.
 */
export function bucketQadaBacklog(
  items: QadaBacklogItem[],
  sevenDaysAgoStr: string,
  thirtyDaysAgoStr: string
): QadaBacklogBuckets {
  const last7: QadaBacklogItem[] = [];
  const month: QadaBacklogItem[] = [];
  const older: QadaBacklogItem[] = [];
  for (const item of items) {
    if (item.date >= sevenDaysAgoStr) last7.push(item);
    else if (item.date >= thirtyDaysAgoStr) month.push(item);
    else older.push(item);
  }
  return { last7, month, older };
}
