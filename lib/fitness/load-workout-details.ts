import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SessionExercise } from "@/components/fitness/session-detail-panel";

export type DayWorkout = {
  id: string;
  name: string;
  exercises: SessionExercise[];
};

/**
 * Shared by the Fitness page's full week and Home's single on-plan card
 * (spec §2.1/§3.1) — both surfaces write through the same confirm RPC (029)
 * and must agree on what a workout's exercises and progression numbers
 * are, or they'd silently diverge on what "today's workout" means.
 * Extracted rather than duplicated for exactly that reason.
 */
export async function loadWorkoutDetails(
  supabase: SupabaseClient<Database>,
  userId: string,
  workoutIds: string[]
): Promise<Map<string, DayWorkout>> {
  const workoutsById = new Map<string, DayWorkout>();
  if (workoutIds.length === 0) return workoutsById;

  const { data: workoutDetailRows } = await supabase
    .from("workouts")
    .select(
      "id, name, workout_exercises(exercise_id, position, target_sets, target_reps_low, target_reps_high, target_load, exercises(name, primary_muscles, secondary_muscles))"
    )
    .in("id", workoutIds);

  const exerciseIdsInPlay = Array.from(
    new Set((workoutDetailRows ?? []).flatMap((w) => (w.workout_exercises ?? []).map((we) => we.exercise_id)))
  );

  const { data: lastSetRows } =
    exerciseIdsInPlay.length > 0
      ? await supabase
          .from("session_sets")
          .select("exercise_id, sets, reps, load, workout_sessions!inner(date, source, user_id)")
          .eq("workout_sessions.user_id", userId)
          .eq("workout_sessions.source", "confirmed")
          .in("exercise_id", exerciseIdsInPlay)
          .order("workout_sessions(date)", { ascending: false })
      : { data: [] };

  const lastTopSetByExercise = new Map<string, { load: number | null; reps: number }>();
  for (const row of lastSetRows ?? []) {
    if (row.exercise_id && !lastTopSetByExercise.has(row.exercise_id)) {
      lastTopSetByExercise.set(row.exercise_id, { load: row.load, reps: row.reps });
    }
  }

  for (const w of workoutDetailRows ?? []) {
    workoutsById.set(w.id, {
      id: w.id,
      name: w.name,
      exercises: (w.workout_exercises ?? [])
        .sort((a, b) => a.position - b.position)
        .map((we) => {
          const last = lastTopSetByExercise.get(we.exercise_id) ?? null;
          return {
            exerciseId: we.exercise_id,
            name: we.exercises?.name ?? "",
            targetSets: we.target_sets,
            targetRepsLow: we.target_reps_low,
            targetRepsHigh: we.target_reps_high,
            targetLoad: we.target_load,
            lastTopSet: last ? { load: last.load, reps: last.reps, targetRepsHigh: we.target_reps_high } : null,
          };
        }),
    });
  }

  return workoutsById;
}
