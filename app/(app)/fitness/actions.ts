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

/**
 * Quick-add — a bare single-exercise session, no workout wrapper (spec §4).
 * Scattered same-day entries deliberately stay separate rows; this never
 * merges into an existing session or asks "which one."
 */
export async function quickLogExercise(
  date: string,
  exerciseId: string,
  exerciseName: string,
  sets: number,
  reps: number,
  load: number | null
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { data: session, error: sessionError } = await supabase
    .from("workout_sessions")
    .insert({ user_id: userId, date, workout_id: null, workout_name: null, source: "quick" })
    .select("id")
    .single();
  if (sessionError) throw sessionError;

  const { error: setError } = await supabase.from("session_sets").insert({
    session_id: session.id,
    user_id: userId,
    exercise_id: exerciseId,
    exercise_name: exerciseName,
    position: 1,
    sets,
    reps,
    load,
  });
  if (setError) throw setError;
  revalidatePath("/fitness");
  revalidatePath("/");
}

/**
 * Weight and waist share body_metrics but write independently (spec §6's
 * different rhythms) — each fetches the existing row first and preserves
 * the other column, since a plain upsert on the shared (user_id, date) key
 * would otherwise null out whichever field wasn't part of this call.
 */
export async function logWeight(date: string, weightLb: number): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { data: existing } = await supabase
    .from("body_metrics")
    .select("waist_in")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  const { error } = await supabase
    .from("body_metrics")
    .upsert(
      { user_id: userId, date, weight_lb: weightLb, waist_in: existing?.waist_in ?? null },
      { onConflict: "user_id,date" }
    );
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
}

export async function logWaist(date: string, waistIn: number): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { data: existing } = await supabase
    .from("body_metrics")
    .select("weight_lb")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  const { error } = await supabase
    .from("body_metrics")
    .upsert(
      { user_id: userId, date, waist_in: waistIn, weight_lb: existing?.weight_lb ?? null },
      { onConflict: "user_id,date" }
    );
  if (error) throw error;
  revalidatePath("/fitness");
  revalidatePath("/");
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

/**
 * The plan-session equivalent of confirmWorkoutSession — no RPC (038 added
 * plan_session_id but didn't add a matching function), so idempotency is
 * handled here in JS the same way confirm_workout_session (029) handles it
 * in SQL: insert the parent row first, and on the unique-violation this
 * migration's own workout_sessions_plan_session_unique index throws for a
 * same-day repeat, treat it as success (already confirmed) rather than an
 * error. The session_sets insert only runs after the parent insert
 * succeeds, so a repeat call can never leave a duplicate or partial write.
 */
export async function confirmPlanSession(
  date: string,
  sessionId: string,
  sessionName: string,
  sets: ConfirmSetInput[]
): Promise<void> {
  const { supabase, userId } = await requireUser();

  // workout_id (040) — the legacy mirror two Home readers key completion
  // off (get-domain-snapshots.ts's workoutDone, get-domain-pulse.ts's
  // hasScheduledWorkout), matched against workout_schedule.workout_id
  // (lib/fitness/sync-workout-schedule.ts writes the same plan_sessions
  // value there). Read from the source of truth (plan_sessions.workout_id)
  // rather than trusted client input.
  const { data: planSession, error: planSessionError } = await supabase
    .from("plan_sessions")
    .select("workout_id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (planSessionError) throw planSessionError;

  const { data: session, error: sessionError } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      date,
      workout_id: planSession?.workout_id ?? null,
      workout_name: sessionName,
      source: "confirmed",
      plan_session_id: sessionId,
    })
    .select("id")
    .single();

  if (sessionError) {
    if (sessionError.code === "23505") {
      revalidatePath("/fitness");
      revalidatePath("/");
      return;
    }
    throw sessionError;
  }

  const { error: setsError } = await supabase.from("session_sets").insert(
    sets.map((s) => ({
      session_id: session.id,
      user_id: userId,
      exercise_id: s.exerciseId,
      exercise_name: s.exerciseName,
      position: s.position,
      sets: s.sets,
      reps: s.reps,
      load: s.load,
    }))
  );
  if (setsError) throw setsError;
  revalidatePath("/fitness");
  revalidatePath("/");
}

export type BenchmarkRepsInput = { exerciseId: string; maxReps: number };

/**
 * Cycle Progress checks' benchmark form (spec's confirmed decision: weight,
 * waist, max pull-ups, max push-ups at each 4-week boundary). Weight/waist
 * share body_metrics with the daily entry, same read-existing-then-upsert
 * pattern as logWeight/logWaist so one doesn't null out the other; reps go
 * to fitness_benchmarks (039), one upsert per exercise rather than a fixed
 * pull-ups/push-ups shape, so this works for whatever exercises the user's
 * plans actually reference.
 */
export async function logCycleBenchmark(
  date: string,
  weightLb: number | null,
  waistIn: number | null,
  reps: BenchmarkRepsInput[]
): Promise<void> {
  const { supabase, userId } = await requireUser();

  if (weightLb !== null || waistIn !== null) {
    const { data: existing } = await supabase
      .from("body_metrics")
      .select("weight_lb, waist_in")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    const { error } = await supabase
      .from("body_metrics")
      .upsert(
        { user_id: userId, date, weight_lb: weightLb ?? existing?.weight_lb ?? null, waist_in: waistIn ?? existing?.waist_in ?? null },
        { onConflict: "user_id,date" }
      );
    if (error) throw error;
  }

  for (const r of reps) {
    const { error } = await supabase
      .from("fitness_benchmarks")
      .upsert(
        { user_id: userId, date, exercise_id: r.exerciseId, max_reps: r.maxReps },
        { onConflict: "user_id,date,exercise_id" }
      );
    if (error) throw error;
  }

  revalidatePath("/fitness");
  revalidatePath("/");
}
