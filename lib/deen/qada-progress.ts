import type { AccentToken } from "@/lib/accent-tokens";

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

/**
 * Opus Lead review (2026-08-16): KPI tint follows the card's own value, not
 * the domain accent. Binary rather than thresholded — no "large backlog"
 * number was ever specified, so any owed count is flagged rather than
 * guessing at a cutoff.
 */
export function accentForQadaBacklog(owed: number): AccentToken {
  return owed === 0 ? "business" : "deen";
}
