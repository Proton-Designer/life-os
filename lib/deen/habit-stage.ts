export type HabitStage = "active_build" | "stabilized" | "locked";
/** null (or the parameter omitted) means "no override — derive from committed_date." */
export type StageOverride = HabitStage | null;

const VALID_STAGES: readonly HabitStage[] = ["active_build", "stabilized", "locked"];

/** Mirrors `lib/habits/queries.ts`'s own `NEW_HABIT_WINDOW_DAYS` — same rule, same number, two independent habit systems (identity_habits vs. deen_habits) that happen to agree, not two copies of one shared constant (the two tables/pages have no code in common to hang a shared import off of). */
const NEW_HABIT_DAYS = 7;

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

/**
 * P3-06 — the "New" badge inside the "Active Build" staging window (Days
 * 0–13): the Habits page (`identity_habits`) already refuses to judge a
 * habit for its first 7 local days (`lib/habits/queries.ts`'s `isNew`,
 * `NEW_HABIT_WINDOW_DAYS`); Habit Builder's own committed_date-derived
 * stages never distinguished a habit's very first week from the rest of
 * its Active Build window, so day 1 and day 12 read identically. This
 * mirrors that same "under 7 days old" rule here, purely by AGE — deliberately
 * INDEPENDENT of `stageOverride` (a manually-overridden stage answers a
 * different question, "what stage is this in," not "is this brand new";
 * a habit pinned to Stabilized/Locked the same day it was created is a
 * real, if unusual, case a manual override exists to allow, and it should
 * still read as new by age). ADDITIVE, not a stage change: the underlying
 * 0-13/14-29/30+ boundaries (`habitStage` above) are UNCHANGED — this
 * only adds a badge on top, same "supplement, don't replace" shape P2-15
 * used for the Self-Mastery closer.
 *
 * `committedDate`/`todayStr` are both already-resolved LOCAL calendar-date
 * strings (never raw `Date`s) — same contract `habitStage` itself already
 * has, so this carries no timezone risk of its own.
 */
export function isNewHabit(committedDate: string, todayStr: string): boolean {
  return daysBetween(committedDate, todayStr) < NEW_HABIT_DAYS;
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`);
  const to = new Date(`${toDateStr}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
