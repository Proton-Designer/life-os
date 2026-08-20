"use client";

import { RepGoalBars, type RepGoalBar } from "./rep-goal-bars";
import { QuickAddSheet } from "./quick-add-sheet";
import type { ExerciseOption } from "./exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";

/**
 * Composes the Home-surface pieces of spec §5/§6: the starter-plan rep
 * bars and the general quick-add — reachable without opening /fitness.
 * Weight/waist logging moved to the Fitness page's Body panel (Ayman,
 * 2026-08-20) — Home shouldn't duplicate it, and the ongoing nudge lives
 * in the notification bell now instead of a standing widget here.
 */
export function HomeFitnessPanel({
  repGoals,
  quickAddExercises,
  onQuickLogExercise,
  onCreateExercise,
}: {
  repGoals: RepGoalBar[];
  quickAddExercises: ExerciseOption[];
  onQuickLogExercise: (exerciseId: string, exerciseName: string, sets: number, reps: number, load: number | null) => Promise<void>;
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
      <QuickAddSheet exercises={quickAddExercises} onCreateExercise={onCreateExercise} onLog={onQuickLogExercise} />
    </div>
  );
}
