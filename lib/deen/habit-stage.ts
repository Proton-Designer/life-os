export type HabitStage = "active_build" | "stabilized" | "locked";
/** null (or the parameter omitted) means "no override — derive from committed_date." */
export type StageOverride = HabitStage | null;

const VALID_STAGES: readonly HabitStage[] = ["active_build", "stabilized", "locked"];

function isHabitStage(value: unknown): value is HabitStage {
  return typeof value === "string" && (VALID_STAGES as readonly string[]).includes(value);
}

/**
 * Stage is computed from committed_date, never stored (avoids a second
 * source of truth that can drift) — see design spec: 0-13 days elapsed ->
 * Active Build, 14-29 -> Stabilized, 30+ -> Locked. Streak is tracked
 * separately (lib/deen/habit-streak.ts) and does NOT gate promotion.
 *
 * `stageOverride` (2026-08-25/26, item 6) lets Ayman manually pin a habit's
 * stage — when set it wins outright over the derived rule, no matter what
 * committed_date says. A garbage stored value (a DB constraint guards new
 * writes, but not what an old row or a future manual fix might leave)
 * falls back to the derived stage rather than throwing — this function
 * must never crash a page render over a corrupt override.
 */
export function habitStage(committedDate: string, todayStr: string, stageOverride?: StageOverride): HabitStage {
  if (isHabitStage(stageOverride)) return stageOverride;

  const daysSinceCommitted = daysBetween(committedDate, todayStr);
  if (daysSinceCommitted <= 13) return "active_build";
  if (daysSinceCommitted <= 29) return "stabilized";
  return "locked";
}

/** Whether a stored override value is actually in effect (vs null/undefined/garbage falling through to the derived rule). */
export function isStageOverridden(stageOverride: StageOverride): boolean {
  return isHabitStage(stageOverride);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`);
  const to = new Date(`${toDateStr}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
