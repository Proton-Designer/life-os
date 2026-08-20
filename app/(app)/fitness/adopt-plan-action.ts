"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import { SEED_PLANS, STARTER_REP_GOALS, type SeedExercise } from "@/lib/fitness/seed-plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * "Start from one of these" (spec §4.1) — adopting Plan A/B/C, and
 * separately, turning on the starter plan's two daily rep goals (spec
 * §5). Two distinct actions, not one, because the two objects are
 * orthogonal (spec §5: "do not force one day-slot to hold two content
 * types") — a caller can adopt a session plan, the starter goals, or both,
 * independently.
 *
 * Both are idempotent: re-running either must not create duplicate rows.
 * Exercises dedupe by name (the `exercises_user_name_unique` partial
 * index backs this, but we look up first rather than relying on the DB to
 * reject a collision, since a rejected insert here would abort the whole
 * adoption instead of just skipping the one exercise that already
 * existed). Workouts dedupe by name the same way — `workouts` has no DB
 * uniqueness constraint on name, so this find-or-create is the only thing
 * preventing a second adoption from creating "Plan A — Session A" twice.
 * `save_workout`'s delete-then-reinsert (031_save_workout_exercises.sql)
 * already makes re-writing an existing workout's exercise list safe on
 * its own. `workout_schedule` assignment upserts on the existing
 * `(user_id, day_of_week)` unique constraint. `rep_goals` upserts on the
 * existing `(user_id, exercise_id) where not archived` partial index.
 */

type TypedClient = SupabaseClient<Database>;

async function findOrCreateExercise(
  supabase: TypedClient,
  userId: string,
  exercise: SeedExercise
): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("exercises")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", exercise.name)
    .eq("archived", false)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      name: exercise.name,
      primary_muscles: exercise.primaryMuscles,
      secondary_muscles: exercise.secondaryMuscles,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function findOrCreateWorkout(supabase: TypedClient, userId: string, name: string): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from("workouts")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .eq("archived", false)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("workouts")
    .insert({ user_id: userId, name })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

/** 0=Sun … 6=Sat, matching workout_schedule.day_of_week — Mon-Fri = 1-5. */
const WEEKDAYS = [1, 2, 3, 4, 5] as const;

// Widened to `string` (not `SeedPlan["key"]`) at the public boundary: this
// is passed as a bound server action into WorkoutList's `onAdoptPlan`,
// whose id comes from a plain string prop (the plan card's `id`) — a
// narrower parameter type here would make that assignment unsound at the
// client boundary. The runtime lookup below still validates it.
export async function adoptSessionPlan(planKey: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const plan = SEED_PLANS.find((p) => p.key === planKey);
  if (!plan) throw new Error(`Unknown seed plan: ${planKey}`);

  const exerciseIdByName = new Map<string, string>();
  for (const workout of plan.workouts) {
    for (const we of workout.exercises) {
      if (exerciseIdByName.has(we.exercise.name)) continue;
      exerciseIdByName.set(we.exercise.name, await findOrCreateExercise(supabase, userId, we.exercise));
    }
  }

  const workoutIdByName = new Map<string, string>();
  for (const workout of plan.workouts) {
    const workoutId = await findOrCreateWorkout(supabase, userId, workout.name);
    workoutIdByName.set(workout.name, workoutId);

    const { error: saveError } = await supabase.rpc("save_workout", {
      p_workout_id: workoutId,
      p_name: workout.name,
      p_exercises: workout.exercises.map((we) => ({
        exerciseId: exerciseIdByName.get(we.exercise.name),
        targetSets: we.targetSets,
        targetRepsLow: we.targetRepsLow,
        targetRepsHigh: we.targetRepsHigh,
        targetLoad: null,
      })),
    });
    if (saveError) throw saveError;
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const dayOfWeek = WEEKDAYS[i];
    const workoutName = plan.weekdayWorkoutNames[i];
    const workoutId = workoutIdByName.get(workoutName);
    if (!workoutId) throw new Error(`Plan ${planKey}: "${workoutName}" is scheduled but was never created`);

    const { error } = await supabase
      .from("workout_schedule")
      .upsert(
        { user_id: userId, day_of_week: dayOfWeek, workout_id: workoutId, workout_name: workoutName },
        { onConflict: "user_id,day_of_week" }
      );
    if (error) throw error;
  }

  revalidatePath("/fitness");
  revalidatePath("/fitness/workouts");
  revalidatePath("/");
}

export async function adoptStarterPlan(): Promise<void> {
  const { supabase, userId } = await requireUser();

  for (const goal of STARTER_REP_GOALS) {
    const exerciseId = await findOrCreateExercise(supabase, userId, goal.exercise);

    const { data: existing, error: selectError } = await supabase
      .from("rep_goals")
      .select("id")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .eq("archived", false)
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const { error } = await supabase
        .from("rep_goals")
        .update({ daily_target: goal.dailyTarget, active_days: goal.activeDays })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("rep_goals").insert({
        user_id: userId,
        exercise_id: exerciseId,
        daily_target: goal.dailyTarget,
        active_days: goal.activeDays,
      });
      if (error) throw error;
    }
  }

  revalidatePath("/fitness");
  revalidatePath("/");
}
