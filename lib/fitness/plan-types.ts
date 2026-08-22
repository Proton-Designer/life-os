/**
 * Plan-authoring type contract — shared between Engineer A (this repo's
 * server actions + pure libs) and Engineer B (the My Workouts builder/UI).
 * docs/superpowers/plans/2026-08-22-fitness-system.md, "Type contract,
 * part 2 — plan authoring." Only the Lead amends these; do not fork a
 * local variant.
 */

export type PlanKind = "micro" | "routine";

/** 0=Sun .. 6=Sat, repo-wide convention. Presets expand to this on save; the preset name itself is never persisted. */
export type ScheduleDays = number[];

export type WorkoutPlanSummary = {
  id: string;
  name: string;
  kind: PlanKind;
  /** micro exercises, or sessions */
  itemCount: number;
  isActive: boolean;
};

export type MicroExerciseDraft = {
  /** null = not yet persisted */
  id: string | null;
  exerciseId: string;
  name: string;
  scheduleDays: ScheduleDays;
  goalType: "daily_total" | "frequency";
  /** reps if daily_total, bouts if frequency */
  goalValue: number;
  notes: string | null;
};

export type SessionExerciseDraft = {
  id: string | null;
  exerciseId: string;
  name: string;
  durationMinutes: number;
  loadLb: number | null;
  targetSets: number | null;
  targetReps: number | null;
};

export type SessionDraft = {
  id: string | null;
  name: string;
  scheduleDays: ScheduleDays;
  /** "HH:MM" local, null = unscheduled band */
  startTime: string | null;
  exercises: SessionExerciseDraft[];
};

export type PlanDraft =
  | { kind: "micro"; id: string | null; name: string; exercises: MicroExerciseDraft[] }
  | { kind: "routine"; id: string | null; name: string; sessions: SessionDraft[] };

export type ActivePlans = { microPlanId: string | null; routinePlanId: string | null };

export type WeekPreviewItem =
  | { kind: "micro"; name: string; goalLabel: string }
  | { kind: "session"; name: string; startTime: string | null; durationMinutes: number };

/** keyed 0..6, Sunday first */
export type WeekPreview = Record<number, WeekPreviewItem[]>;
