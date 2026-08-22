"use client";

import { RepGoalBars, type RepGoalBar } from "./rep-goal-bars";
import { QuickAddSheet } from "./quick-add-sheet";
import type { ExerciseOption } from "./exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";

/**
 * Interim logging surface for the /fitness "Log" panel (Ayman, 2026-08-22
 * — Home's Fitness panel, the only general "log anything" affordance in
 * the app, was removed as part of the fitness rebuild, see f17ecd1). This
 * is the client-side composition boundary: the bound server actions below
 * are real Server Action references passed in as props (AGENTS.md-safe),
 * and the reps-only -> full quickLogExercise signature adaptation happens
 * HERE, inside a Client Component, not in the calling Server Component —
 * a page.tsx wrapping a server action in an inline arrow before handing it
 * to a Client Component is exactly the RSC-boundary violation AGENTS.md
 * warns about (jsdom/tsc won't catch it; only a live browser console will).
 * Replaced wholesale once Daily Log ships.
 */
export function FitnessLogPanel({
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
