"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";

export async function addHabit(name: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("custom_habits")
    .insert({ user_id: userId, domain: "fitness", name });
  if (error) throw error;
  revalidatePath("/fitness");
}

export async function toggleHabit(habitId: string, date: string): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: existing } = await supabase
    .from("habit_logs")
    .select("completed")
    .eq("habit_id", habitId)
    .eq("date", date)
    .maybeSingle();

  const { error } = await supabase.from("habit_logs").upsert(
    {
      habit_id: habitId,
      user_id: userId,
      date,
      completed: !existing?.completed,
    },
    { onConflict: "habit_id,date" }
  );
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}

/**
 * Archives (never hard-deletes) — custom_habits.archived exists for this;
 * hard-deleting would cascade-delete the habit's historical habit_logs via
 * the FK, destroying past streak/consistency data.
 */
export async function removeHabit(habitId: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("custom_habits")
    .update({ archived: true })
    .eq("id", habitId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/fitness");
}

export async function setWorkoutSchedule(
  dayOfWeek: number,
  workoutName: string | null,
  time: string | null,
  /** Null means "not specified" — falls back to the nominal 30m in the check-in pre-fill (lib/checkins/prefill.ts), not an error and not coerced to a default here. */
  durationMinutes: number | null = null
): Promise<void> {
  const { supabase, userId } = await requireUser();

  if (workoutName === null) {
    const { error } = await supabase
      .from("workout_schedule")
      .delete()
      .eq("user_id", userId)
      .eq("day_of_week", dayOfWeek);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("workout_schedule").upsert(
      { user_id: userId, day_of_week: dayOfWeek, workout_name: workoutName, time, duration_minutes: durationMinutes },
      { onConflict: "user_id,day_of_week" }
    );
    if (error) throw error;
  }
  revalidatePath("/fitness");
  revalidatePath("/");
}

export async function logWorkout(
  date: string,
  workoutName: string,
  source: "scheduled" | "adhoc"
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("workout_logs").insert({
    user_id: userId,
    date,
    workout_name: workoutName,
    source,
  });
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}

/**
 * Assigns (or clears) a weekday's workout in the new structured model —
 * spec §2/§4, distinct from the legacy free-text `setWorkoutSchedule`
 * above, which stays untouched for Phase 7 to retire once nothing reads
 * it. `workoutId: null` clears the day; `workout_name`/`time`/
 * `duration_minutes` are left alone here since this action only ever
 * targets the workout_id column.
 */
export async function assignWorkoutToDay(dayOfWeek: number, workoutId: string | null): Promise<void> {
  const { supabase, userId } = await requireUser();
  if (workoutId === null) {
    const { error } = await supabase
      .from("workout_schedule")
      .update({ workout_id: null })
      .eq("user_id", userId)
      .eq("day_of_week", dayOfWeek);
    if (error) throw error;
  } else {
    // workout_name is NOT NULL on this legacy column — the new model reads
    // workout_id as the source of truth, but the row still needs a
    // non-null placeholder, so this snapshots the workout's current name
    // rather than leaving a stale or empty string.
    const { data: workout, error: fetchError } = await supabase
      .from("workouts")
      .select("name")
      .eq("id", workoutId)
      .eq("user_id", userId)
      .single();
    if (fetchError) throw fetchError;

    const { error } = await supabase.from("workout_schedule").upsert(
      { user_id: userId, day_of_week: dayOfWeek, workout_id: workoutId, workout_name: workout.name },
      { onConflict: "user_id,day_of_week" }
    );
    if (error) throw error;
  }
  revalidatePath("/fitness");
}

export type ConfirmSetInput = {
  exerciseId: string;
  exerciseName: string;
  position: number;
  sets: number;
  reps: number;
  load: number | null;
};

/**
 * Thin wrapper over the confirm_workout_session RPC (029) — idempotency,
 * ownership, and the atomic session+session_sets write all live in the
 * database function, live-proved in Phase 3. This action just shapes the
 * payload.
 */
export async function confirmWorkoutSession(
  date: string,
  workoutId: string,
  workoutName: string,
  sets: ConfirmSetInput[]
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("confirm_workout_session", {
    p_date: date,
    p_workout_id: workoutId,
    p_workout_name: workoutName,
    p_sets: sets.map((s) => ({
      exerciseId: s.exerciseId,
      exerciseName: s.exerciseName,
      position: s.position,
      sets: s.sets,
      reps: s.reps,
      load: s.load,
    })),
  });
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}
