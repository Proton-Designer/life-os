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
