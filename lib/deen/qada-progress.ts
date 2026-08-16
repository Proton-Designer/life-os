/**
 * How many prayers were caught up (logged as qada) within the given rows —
 * the caller pre-filters to the window (e.g. last 7 days). qada_owed itself
 * is a single mutable counter with no history table, so a real "trend" over
 * time isn't reconstructable; this is the closest genuinely-derived signal
 * available without new schema — recent catch-up activity, not a fabricated
 * trend line.
 */
export function countRecentQadaCatchUps(rows: { date: string; status: string }[]): number {
  return rows.filter((r) => r.status === "qada").length;
}
