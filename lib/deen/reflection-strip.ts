export type ReflectionTierEntry = { date: string; tier: 1 | 2 | 3 };
/** A stored reflection entry, with its logged instant — the tracker needs
 * `createdAt` for the time-of-day view; the strip only ever reads
 * date/tier, so ReflectionTierEntry stays the narrower shape it depends on. */
export type ReflectionEntry = ReflectionTierEntry & { createdAt: string };
export type ReflectionDayBucket = "clear" | "low" | "mid" | "high" | "in_progress";
export type ReflectionStripDay = { date: string; weight: number; bucket: ReflectionDayBucket };

const DAYS_SHOWN = 30;

/**
 * Day-weight aggregation rule (spec §5A) — a real product decision, not an
 * implementation detail: a day's weight is the sum of its entries' tiers
 * (Light 1, Moderate 2, Heavy 3). Nothing stops several entries of
 * different weights landing on one day, so a single per-day status
 * (ConsistencyGrid's contract) can't represent this — the strip needs an
 * ordinal weight instead.
 */
export function dayWeight(entries: { tier: 1 | 2 | 3 }[]): number {
  return entries.reduce((sum, e) => sum + e.tier, 0);
}

/** 0 clear · 1-2 low · 3-5 mid · 6+ high. */
export function bucketForWeight(weight: number): ReflectionDayBucket {
  if (weight === 0) return "clear";
  if (weight <= 2) return "low";
  if (weight <= 5) return "mid";
  return "high";
}

/** Last 30 days (oldest first, ending today), each with its weight and bucket. */
export function buildReflectionStrip(entries: ReflectionTierEntry[], todayStr: string): ReflectionStripDay[] {
  const days: ReflectionStripDay[] = [];
  const today = new Date(`${todayStr}T00:00:00Z`);
  for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    days.push({ date: date.toISOString().slice(0, 10), weight: 0, bucket: "clear" });
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const entriesByDate = new Map<string, { tier: 1 | 2 | 3 }[]>();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) continue;
    const bucket = entriesByDate.get(entry.date) ?? [];
    bucket.push(entry);
    entriesByDate.set(entry.date, bucket);
  }

  for (const [date, dayEntries] of entriesByDate) {
    const day = byDate.get(date)!;
    day.weight = dayWeight(dayEntries);
    day.bucket = bucketForWeight(day.weight);
  }

  // Today isn't over — a zero-entry today hasn't earned "clear" the way a
  // finished day has, and a single evening entry would silently revoke it.
  // Real weight already logged today stands as-is (that already happened);
  // only the false "clear" verdict on an empty, still-running day is wrong.
  const todayCell = byDate.get(todayStr);
  if (todayCell && todayCell.weight === 0) {
    todayCell.bucket = "in_progress";
  }

  return days;
}

/** "N of the last 30 days clear" headline count — the rolling metric, never a streak. */
export function countClearDays(strip: ReflectionStripDay[]): number {
  return strip.filter((d) => d.bucket === "clear").length;
}
