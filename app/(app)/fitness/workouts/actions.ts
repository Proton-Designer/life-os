"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import type { MuscleGroup } from "@/lib/fitness/volume";

export type ExerciseInput = {
  exerciseId: string;
  targetSets: number;
  targetRepsLow: number;
  targetRepsHigh: number;
  targetLoad: number | null;
};

export async function createExercise(
  name: string,
  primaryMuscles: MuscleGroup[],
  secondaryMuscles: MuscleGroup[]
): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("exercises")
    .insert({ user_id: userId, name, primary_muscles: primaryMuscles, secondary_muscles: secondaryMuscles })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/fitness/workouts");
  return { id: data.id };
}

export async function archiveExercise(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("exercises").update({ archived: true }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/fitness/workouts");
}

/**
 * Creates the workout row and saves its exercise list in one call — the
 * builder's "Save" for a brand-new workout, before it has an id to target
 * with `saveWorkout`. Not wrapped in a single transaction with the RPC (two
 * round trips), but that's not a corruption risk: a failure between them
 * leaves a named workout with zero exercises, an incomplete-but-valid state
 * he can just re-save, not a half-written invalid one.
 */
export async function createWorkoutWithExercises(
  name: string,
  exercises: ExerciseInput[]
): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase.from("workouts").insert({ user_id: userId, name }).select("id").single();
  if (error) throw error;
  const { error: rpcError } = await supabase.rpc("save_workout", {
    p_workout_id: data.id,
    p_name: name,
    p_exercises: exercises,
  });
  if (rpcError) throw rpcError;
  revalidatePath("/fitness/workouts");
  return { id: data.id };
}

export async function saveWorkout(workoutId: string, name: string, exercises: ExerciseInput[]): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_workout", {
    p_workout_id: workoutId,
    p_name: name,
    p_exercises: exercises,
  });
  if (error) throw error;
  revalidatePath("/fitness/workouts");
}

export async function renameWorkout(id: string, name: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("workouts").update({ name }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/fitness/workouts");
}

export async function archiveWorkout(id: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("workouts").update({ archived: true }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/fitness/workouts");
  revalidatePath("/fitness");
}

/**
 * Duplicate copies the workout's current exercise list at the moment of
 * duplication — a fresh, independently-editable workout, not a live
 * reference to the original. Matches spec §4's "duplicate" row action.
 */
export async function duplicateWorkout(id: string): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const { data: original, error: fetchError } = await supabase
    .from("workouts")
    .select("name, workout_exercises(exercise_id, position, target_sets, target_reps_low, target_reps_high, target_load)")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const exercises: ExerciseInput[] = (original.workout_exercises ?? [])
    .sort((a, b) => a.position - b.position)
    .map((e) => ({
      exerciseId: e.exercise_id,
      targetSets: e.target_sets,
      targetRepsLow: e.target_reps_low,
      targetRepsHigh: e.target_reps_high,
      targetLoad: e.target_load,
    }));

  return createWorkoutWithExercises(`${original.name} (copy)`, exercises);
}
