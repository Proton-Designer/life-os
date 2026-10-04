import { PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import { addMonthsToDateString } from "@/lib/date-utils";
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

/** The Qada preview/backlog covers this many calendar months back from today (QADA-3M, user request). */
export const QADA_WINDOW_MONTHS = 3;

/**
 * First calendar day (inclusive) of the Qada window: exactly 3 calendar months
 * before `todayStr` (the user's LOCAL date -- pass localDateString(now, tz), never
 * a raw Date). Pure calendar arithmetic with day clamping (May 31 -> Feb 28/29).
 * The tracking floor still applies on top: resolvePrayerStatuses never derives a
 * "missed" before `tracking_started_on`, so nothing before tracking began is counted.
 */
export function qadaWindowStart(todayStr: string): string {
  return addMonthsToDateString(todayStr, -QADA_WINDOW_MONTHS);
}

/** Keep only backlog items inside the window (date >= windowStart); order is inherited. */
export function itemsInQadaWindow(items: QadaBacklogItem[], todayStr: string): QadaBacklogItem[] {
  const start = qadaWindowStart(todayStr);
  return items.filter((i) => i.date >= start);
}
