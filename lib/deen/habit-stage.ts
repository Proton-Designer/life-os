export type HabitStage = "active_build" | "stabilized" | "locked";

/**
 * Stage is computed from committed_date, never stored (avoids a second
 * source of truth that can drift) — see design spec: 0-13 days elapsed ->
 * Active Build, 14-29 -> Stabilized, 30+ -> Locked. Streak is tracked
 * separately (lib/deen/habit-streak.ts) and does NOT gate promotion.
 */
export function habitStage(committedDate: string, today: string): HabitStage {
  const daysSinceCommitted = daysBetween(committedDate, today);
  if (daysSinceCommitted <= 13) return "active_build";
  if (daysSinceCommitted <= 29) return "stabilized";
  return "locked";
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`);
  const to = new Date(`${toDateStr}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
