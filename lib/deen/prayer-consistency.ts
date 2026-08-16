const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export type PrayerHistoryRow = { date: string; prayer_name: string; status: string };

/** Shapes prayer history into ConsistencyGrid's rows — always all 5 prayers, Fajr..Isha order. */
export function buildPrayerConsistencyRows(rows: PrayerHistoryRow[], days: string[]) {
  return PRAYER_NAMES.map((name) => ({
    label: PRAYER_LABEL[name],
    cells: days.map((date) => ({
      date,
      status: rows.find((r) => r.date === date && r.prayer_name === name)?.status ?? "pending",
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
