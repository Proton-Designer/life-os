import { PRAYER_NAMES } from "@/lib/prayer-times/windows";
import type { ResolvedDayStatuses } from "./prayer-status";

const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export type PrayerHistoryRow = { date: string; prayer_name: string; status: string };

/**
 * Shapes prayer history into ConsistencyGrid's rows — always all 5 prayers,
 * Fajr..Isha order. Takes already-resolved effective statuses (see
 * lib/deen/prayer-status.ts's resolvePrayerStatuses) rather than raw rows,
 * so a genuinely-missed unlogged prayer shows as missed here, not a generic
 * pending default forever.
 */
export function buildPrayerConsistencyRows(resolved: Record<string, ResolvedDayStatuses>, days: string[]) {
  return PRAYER_NAMES.map((name) => ({
    label: PRAYER_LABEL[name],
    cells: days.map((date) => ({
      date,
      status: resolved[date]?.[name] ?? "pending",
    })),
  }));
}

/** Percent of every prayer-slot in the window (days x 5) logged on_time — the grid panel's hero. */
export function computeOnTimeRate(rows: PrayerHistoryRow[], dayCount: number): number {
  const totalSlots = dayCount * 5;
  if (totalSlots === 0) return 0;
  const onTime = rows.filter((r) => r.status === "on_time").length;
  return Math.round((onTime / totalSlots) * 100);
}
