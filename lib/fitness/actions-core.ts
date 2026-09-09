import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MuscleGroup } from "./volume";

/**
 * R5 core(supabase, userId, ...) extraction for fitness's LOGGING surface —
 * the owner's "checking off logs" requirement in its heaviest form
 * (team-lead's framing), plus the handful of simple exercise/workout edits
 * that are low-risk enough to wire without touching the plan-editing
 * machinery. Same discipline as lib/deen/actions-core.ts,
 * lib/business/actions-core.ts, lib/school/actions-core.ts: none of these
 * call requireUser()/getProfile()/getAuthedUser().
 *
 * DELIBERATELY NOT HERE — the plan-editing/plan-schedule machinery
 * (savePlan, deletePlan, activatePlan, deactivateSlot,
 * createPlanFromTemplate, createWorkoutWithExercises, saveWorkout,
 * duplicateWorkout, setWorkoutSchedule, assignWorkoutToDay) — per the
 * lead's explicit instruction to prioritize logging/body-metrics writes
 * over exhaustive plan-editing coverage, and because several of those
 * paths are the program's known scar tissue (migration 129's
 * active_workout_plans FK bug, the workout_schedule sync shim that
 * silently re-derives/wipes the table on every plan mutation). See
 * docs/ai-connector/FITNESS-WRITE-SCOPE-DECISIONS.md for the full
 * reasoning on every excluded write path.
 *
 * `logCycleBenchmark`'s combined weight/waist/reps call (app/(app)/fitness/
 * actions.ts) is deliberately left UNTOUCHED rather than refactored to
 * call `logWeightCore`/`logWaistCore`/`logBenchmarkRepsCore` — it has
 * three distinct effects in one call, a shape none of the exposed MCP
 * actions needs, and touching a working multi-effect function to share
 * code with three independent single-effect ones is a bigger risk than the
 * small duplication of `logBenchmarkRepsCore`'s 3-line upsert.
 */

export type ConfirmSetInput = {
  exerciseId: string;
  exerciseName: string;
  position: number;
  sets: number;
  reps: number;
  load: number | null;
};

/**
 * Quick-add — a bare single-exercise session, no workout wrapper (spec
 * §4). Scattered same-day entries deliberately stay separate rows; this
 * never merges into an existing session or asks "which one." Returns the
 * new session's real id for MCP's {id, updated_at} write contract.
 */
export async function quickLogExerciseCore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  exerciseId: string,
  exerciseName: string,
  sets: number,
  reps: number,
  load: number | null
): Promise<string> {
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
  return session.id;
}

/**
 * Thin wrapper over the confirm_workout_session RPC (029) — idempotency,
 * ownership, and the atomic session+session_sets write all live in the
 * database function (security invoker, scoped by auth.uid() internally),
 * which is why this needs no userId parameter of its own — same posture as
 * lib/coop/targets-core.ts's moveTargetCore calling reorder_coop_target.
 */
export async function confirmWorkoutSessionCore(
  supabase: SupabaseClient,
  date: string,
  workoutId: string,
  workoutName: string,
  sets: ConfirmSetInput[]
): Promise<string | null> {
  const { data, error } = await supabase.rpc("confirm_workout_session", {
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
  // The RPC `returns uuid` -- the original cookie action (app/(app)/fitness/
  // actions.ts) discards it, but MCP's {id, updated_at} write contract
  // needs a real id, and capturing it here is additive, not a behavior
  // change for the existing caller.
  return (data as string | null) ?? null;
}

/**
 * The plan-session equivalent of confirmWorkoutSessionCore — no RPC (038
 * added plan_session_id but didn't add a matching function), so
 * idempotency is handled here in JS the same way confirm_workout_session
 * (029) handles it in SQL: insert the parent row first, and on the
 * unique-violation this migration's own workout_sessions_plan_session_unique
 * index throws for a same-day repeat, treat it as success (already
 * confirmed) rather than an error.
 */
export async function confirmPlanSessionCore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  sessionId: string,
  sessionName: string,
  sets: ConfirmSetInput[]
): Promise<string | null> {
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
      // Already confirmed -- the original cookie action just returns here
      // (treat as success, no id needed). MCP's write contract benefits
      // from a real id, so look the already-confirmed row back up rather
      // than reporting null for something that does, in fact, exist.
      const { data: existing } = await supabase
        .from("workout_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("date", date)
        .eq("plan_session_id", sessionId)
        .eq("source", "confirmed")
        .maybeSingle();
      return existing?.id ?? null;
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
  return session.id;
}

/** Weight and waist share body_metrics but write independently (spec §6's different rhythms) — reads the existing row first and preserves the other column, since a plain upsert on the shared (user_id, date) key would otherwise null out whichever field wasn't part of this call. */
export async function logWeightCore(supabase: SupabaseClient, userId: string, date: string, weightLb: number): Promise<void> {
  const { data: existing } = await supabase.from("body_metrics").select("waist_in").eq("user_id", userId).eq("date", date).maybeSingle();
  const { error } = await supabase
    .from("body_metrics")
    .upsert({ user_id: userId, date, weight_lb: weightLb, waist_in: existing?.waist_in ?? null }, { onConflict: "user_id,date" });
  if (error) throw error;
}

export async function logWaistCore(supabase: SupabaseClient, userId: string, date: string, waistIn: number): Promise<void> {
  const { data: existing } = await supabase.from("body_metrics").select("weight_lb").eq("user_id", userId).eq("date", date).maybeSingle();
  const { error } = await supabase
    .from("body_metrics")
    .upsert({ user_id: userId, date, waist_in: waistIn, weight_lb: existing?.weight_lb ?? null }, { onConflict: "user_id,date" });
  if (error) throw error;
}

/** One exercise's max-reps benchmark for a date (Cycle Progress checks) — a fresh, faithful extraction of logCycleBenchmark's reps-loop body, not a shared call into it. See this file's header comment for why. */
export async function logBenchmarkRepsCore(supabase: SupabaseClient, userId: string, date: string, exerciseId: string, maxReps: number): Promise<void> {
  const { error } = await supabase
    .from("fitness_benchmarks")
    .upsert({ user_id: userId, date, exercise_id: exerciseId, max_reps: maxReps }, { onConflict: "user_id,date,exercise_id" });
  if (error) throw error;
}

export async function createExerciseCore(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  primaryMuscles: MuscleGroup[],
  secondaryMuscles: MuscleGroup[]
): Promise<string> {
  const { data, error } = await supabase
    .from("exercises")
    .insert({ user_id: userId, name, primary_muscles: primaryMuscles, secondary_muscles: secondaryMuscles })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Archives (never hard-deletes) — exercises are referenced by workout_exercises/session_sets/etc. with no cascading delete, same archive-don't-delete convention as everywhere else in this codebase. */
export async function archiveExerciseCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("exercises").update({ archived: true }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function renameWorkoutCore(supabase: SupabaseClient, userId: string, id: string, name: string): Promise<void> {
  const { error } = await supabase.from("workouts").update({ name }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/** Archives (never hard-deletes) — same convention as archiveExerciseCore. */
export async function archiveWorkoutCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("workouts").update({ archived: true }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}
