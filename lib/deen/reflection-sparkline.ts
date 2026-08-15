export type ReflectionEntry = { date: string; tier: 1 | 2 | 3 };
export type ReflectionDayCounts = { date: string; counts: Record<1 | 2 | 3, number> };

const DAYS_SHOWN = 7;

/** Last 7 days (oldest first, ending today) of per-tier reflection tally counts, for the sparkline. */
export function buildReflectionSparkline(entries: ReflectionEntry[], todayStr: string): ReflectionDayCounts[] {
  const days: ReflectionDayCounts[] = [];
  const today = new Date(`${todayStr}T00:00:00Z`);

  for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    days.push({ date: date.toISOString().slice(0, 10), counts: { 1: 0, 2: 0, 3: 0 } });
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (day) day.counts[entry.tier]++;
  }

  return days;
}
