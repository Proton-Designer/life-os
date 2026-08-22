import type {
  MicroExerciseDraft,
  PlanDraft,
  ScheduleDays,
  SessionDraft,
  WeekPreview,
  WeekPreviewItem,
} from "./plan-types";

/**
 * Plan-week expansion — pure functions, no React, no I/O. The repo's
 * lib/checkins/schedule.ts pattern. docs/superpowers/plans/2026-08-22-fitness-system.md,
 * "Type contract, part 2" / "The integration seam."
 *
 * `expandPlanToWeek` takes a PlanDraft, not a persisted plan, and is the
 * ONE function that renders both the builder's live (unsaved) preview and
 * the saved-plan calendar at the bottom of My Workouts — same signature,
 * same output shape, no second implementation to drift from this one.
 *
 * This file also owns SCHEDULE_PRESETS: the six schedule options (everyday
 * / weekdays / weekends / M-W / T-Th / custom) are a UI-only concept that
 * expands to a plain day array on save — the preset name is never
 * persisted, so one place owning the expansion means the UI's preset list
 * can change without touching the database or any reader.
 */

export type SchedulePreset = "everyday" | "weekdays" | "weekends" | "mw" | "tth" | "custom";

const PRESET_DAYS: Record<Exclude<SchedulePreset, "custom">, ScheduleDays> = {
  everyday: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
  mw: [1, 3],
  tth: [2, 4],
};

/**
 * `custom` passes `customDays` through (sanitized) unchanged — every other
 * preset ignores whatever `customDays` was passed, since the preset itself
 * is authoritative. An unrecognized preset string (hostile/stale caller)
 * falls back to `weekdays`, the table-wide default, rather than throwing.
 */
export function expandPreset(preset: SchedulePreset, customDays?: ScheduleDays): ScheduleDays {
  if (preset === "custom") return sanitizeDays(customDays ?? []);
  return PRESET_DAYS[preset] ?? PRESET_DAYS.weekdays;
}

/** Dedupe, drop anything not a finite integer 0-6 — hostile/empty input becomes an empty schedule, never a crash. */
function sanitizeDays(days: ScheduleDays): ScheduleDays {
  const seen = new Set<number>();
  for (const d of days ?? []) {
    if (Number.isInteger(d) && d >= 0 && d <= 6) seen.add(d);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function sanitizeMinutes(minutes: number): number {
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** "30 reps" for a daily-total goal, "3× today" for a frequency goal — an unrecognized goalType renders as "0" rather than throwing. */
function goalLabel(exercise: MicroExerciseDraft): string {
  const value = Number.isFinite(exercise.goalValue) && exercise.goalValue > 0 ? exercise.goalValue : 0;
  if (exercise.goalType === "daily_total") return `${value} reps`;
  if (exercise.goalType === "frequency") return `${value}× today`;
  return `${value}`;
}

function emptyWeek(): WeekPreview {
  const week: WeekPreview = {};
  for (let d = 0; d <= 6; d++) week[d] = [];
  return week;
}

function sessionDurationMinutes(session: SessionDraft): number {
  return (session.exercises ?? []).reduce((sum, ex) => sum + sanitizeMinutes(ex?.durationMinutes), 0);
}

/**
 * Expands one plan draft (micro or routine — never both, per the
 * discriminated union) into a Sunday-first week of preview items. Micro
 * exercises are always all-day bands; sessions carry their own
 * startTime/durationMinutes. Both archetypes render in their draft's
 * array order within a day — deterministic, matches the order the user
 * built them in.
 */
export function expandPlanToWeek(draft: PlanDraft): WeekPreview {
  const week = emptyWeek();
  if (!draft) return week;

  if (draft.kind === "micro") {
    for (const exercise of draft.exercises ?? []) {
      const item: WeekPreviewItem = { kind: "micro", name: exercise.name, goalLabel: goalLabel(exercise) };
      for (const day of sanitizeDays(exercise.scheduleDays)) {
        week[day].push(item);
      }
    }
    return week;
  }

  for (const session of draft.sessions ?? []) {
    const item: WeekPreviewItem = {
      kind: "session",
      name: session.name,
      startTime: session.startTime ?? null,
      durationMinutes: sessionDurationMinutes(session),
    };
    for (const day of sanitizeDays(session.scheduleDays)) {
      week[day].push(item);
    }
  }
  return week;
}
