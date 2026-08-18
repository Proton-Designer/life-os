export type ReflectionTimestampedEntry = { createdAt: string };
export type TimeOfDayBucket = { label: string; startHour: number; endHour: number; count: number };

// Below this, a "cluster" claim would be drawing a pattern out of noise —
// the exact failure the old sparklines committed. Matches the spec's own
// ~8-entry floor.
const MIN_ENTRIES = 8;

// 6-hour buckets, not hourly: at the entry counts this module realistically
// sees, hourly buckets would mostly hold 0-1 entries each — too sparse to
// show a real cluster. Four buckets is coarse enough to be legible and fine
// enough to be actionable ("mostly at night" is a fact you can act on).
const BUCKET_DEFS: { label: string; startHour: number; endHour: number }[] = [
  { label: "Night (12–6am)", startHour: 0, endHour: 6 },
  { label: "Morning (6am–12pm)", startHour: 6, endHour: 12 },
  { label: "Afternoon (12–6pm)", startHour: 12, endHour: 18 },
  { label: "Evening (6pm–12am)", startHour: 18, endHour: 24 },
];

function localHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/**
 * `created_at` is already captured — this costs no new data, just a new
 * read. Buckets entries by *local* hour of day (per the user's own
 * timezone), never UTC, since "clusters at night" only means something
 * relative to the user's own clock. Returns null below MIN_ENTRIES rather
 * than drawing a distribution from too little data to be honest.
 */
export function buildTimeOfDayDistribution(
  entries: ReflectionTimestampedEntry[],
  timezone: string
): TimeOfDayBucket[] | null {
  if (entries.length < MIN_ENTRIES) return null;

  const buckets = BUCKET_DEFS.map((b) => ({ ...b, count: 0 }));
  for (const entry of entries) {
    const hour = localHour(new Date(entry.createdAt), timezone);
    const bucket = buckets.find((b) => hour >= b.startHour && hour < b.endHour);
    if (bucket) bucket.count++;
  }
  return buckets;
}

// A bucket must hold a real plurality — not just the largest of several
// near-equal piles — before the module claims a pattern exists.
const DOMINANCE_THRESHOLD = 0.5;

/**
 * The single bucket a clear majority of entries fall into, or null when
 * nothing clusters (evenly spread, or no entries at all). Feeds the OS
 * layer's suggestion — an observation, never a verdict, so this stays
 * conservative about calling something a "cluster."
 */
export function dominantBucket(buckets: TimeOfDayBucket[]): TimeOfDayBucket | null {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;
  const max = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);
  return max.count / total >= DOMINANCE_THRESHOLD ? max : null;
}
