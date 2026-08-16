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
 * How many prayers were newly marked missed within the given rows — the
 * other half of the backlog's direction (missed prayers are what grow
 * qada_owed; qada catch-ups are what shrink it).
 */
export function countRecentMisses(rows: { date: string; status: string }[]): number {
  return rows.filter((r) => r.status === "missed").length;
}

/**
 * Opus Lead review (2026-08-16): qada backlog is a long-term catch-up
 * project, not an alert — tinting on the absolute owed count pins the card
 * amber permanently the moment anything is owed, which stops carrying any
 * information. Zero owed is still an unambiguous positive (a genuinely
 * resolved state, not a "trend" that needs comparing). Above zero, tint by
 * direction over the window instead: caught up vs. newly missed.
 */
export function accentForQadaBacklog(owed: number, caughtUp: number, missed: number): AccentToken {
  if (owed === 0) return "business";
  const net = caughtUp - missed;
  if (net > 0) return "business";
  if (net < 0) return "deen";
  return "neutral";
}
