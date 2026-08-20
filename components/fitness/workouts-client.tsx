"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/panel";
import { WorkoutList, type WorkoutSummary, type SeedPlan } from "./workout-list";
import { WorkoutBuilder, type BuilderWorkout, type ExerciseInput } from "./workout-builder";
import type { ExerciseOption } from "./exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";

export type FullWorkout = BuilderWorkout;

/**
 * The list/builder mode switch lives here (client state) rather than in
 * page.tsx (a Server Component, can't hold useState) — every server action
 * passed in is a real bound reference from the Server Component parent,
 * never wrapped in a new arrow function at this layer, so the RSC
 * function-prop rule holds all the way down to ExercisePicker.
 */
export function WorkoutsClient({
  exercises,
  workouts,
  seedPlans,
  onCreateExercise,
  onSaveNew,
  onSaveExisting,
  onDuplicate,
  onRename,
  onArchive,
  onAdoptPlan,
}: {
  exercises: ExerciseOption[];
  workouts: FullWorkout[];
  seedPlans: SeedPlan[];
  onCreateExercise: (
    name: string,
    primaryMuscles: MuscleGroup[],
    secondaryMuscles: MuscleGroup[]
  ) => Promise<{ id: string }>;
  onSaveNew: (name: string, exercises: ExerciseInput[]) => Promise<{ id: string }>;
  onSaveExisting: (workoutId: string, name: string, exercises: ExerciseInput[]) => Promise<void>;
  onDuplicate: (id: string) => Promise<{ id: string }>;
  onRename: (id: string, name: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onAdoptPlan?: (planId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null | "new">(null);

  if (editingId !== null) {
    const workout = editingId === "new" ? null : (workouts.find((w) => w.id === editingId) ?? null);
    return (
      <Panel title={workout ? "Edit workout" : "New workout"}>
        <WorkoutBuilder
          workout={workout}
          allExercises={exercises}
          onCreateExercise={onCreateExercise}
          onSaveNew={onSaveNew}
          onSaveExisting={onSaveExisting}
          onDone={() => setEditingId(null)}
        />
      </Panel>
    );
  }

  const summaries: WorkoutSummary[] = workouts.map((w) => ({
    id: w.id,
    name: w.name,
    exerciseCount: w.exercises.length,
  }));

  return (
    <Panel title="My workouts">
      <WorkoutList
        workouts={summaries}
        seedPlans={seedPlans}
        onCreateNew={() => setEditingId("new")}
        onAdoptPlan={onAdoptPlan}
        onEdit={(id) => setEditingId(id)}
        onDuplicate={onDuplicate}
        onRename={onRename}
        onArchive={onArchive}
      />
    </Panel>
  );
}
