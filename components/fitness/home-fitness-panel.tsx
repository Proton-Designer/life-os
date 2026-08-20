"use client";

import { RepGoalBars, type RepGoalBar } from "./rep-goal-bars";
import { BodyMetricsEntry } from "./body-metrics-entry";
import { QuickAddSheet } from "./quick-add-sheet";
import type { ExerciseOption } from "./exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";

/**
 * Composes the Home-surface pieces of spec §5/§6: the starter-plan rep
 * bars, the passive weight affordance + quiet waist nudge, and the general
 * quick-add — all reachable without opening /fitness (the win condition
 * stated across every round of the brainstorm). Purely a wiring layer;
 * each piece is independently tested in its own file.
 */
export function HomeFitnessPanel({
  repGoals,
  waistDue,
  quickAddExercises,
  onQuickLogExercise,
  onLogWeight,
  onLogWaist,
  onCreateExercise,
}: {
  repGoals: RepGoalBar[];
  waistDue: boolean;
  quickAddExercises: ExerciseOption[];
  onQuickLogExercise: (exerciseId: string, exerciseName: string, sets: number, reps: number, load: number | null) => Promise<void>;
  onLogWeight: (weightLb: number) => Promise<void>;
  onLogWaist: (waistIn: number) => Promise<void>;
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <RepGoalBars
        goals={repGoals}
        onLog={(exerciseId, exerciseName, reps) => onQuickLogExercise(exerciseId, exerciseName, 1, reps, null)}
      />
      <BodyMetricsEntry waistDue={waistDue} onLogWeight={onLogWeight} onLogWaist={onLogWaist} />
      <QuickAddSheet exercises={quickAddExercises} onCreateExercise={onCreateExercise} onLog={onQuickLogExercise} />
    </div>
  );
}
