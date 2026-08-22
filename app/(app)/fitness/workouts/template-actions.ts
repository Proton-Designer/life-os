"use server";

import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import { SEED_PLANS, STARTER_REP_GOALS, type SeedExercise } from "@/lib/fitness/seed-plans";
import { syncWorkoutScheduleForActiveRoutine } from "@/lib/fitness/sync-workout-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Seed plans become templates (Lead's ruling, 2026-08-22 —
 * docs/superpowers/plans/2026-08-22-fitness-system.md). Replaces the old
 * adoptSessionPlan/adoptStarterPlan (formerly
 * app/(app)/fitness/adopt-plan-action.ts, deleted once B's rebuilt My
 * Workouts page no longer imported them — deletion-order ruling, B removed
 * the references first), which flattened into loose `workouts` rows /
 * `rep_goals`. This writes ONLY the new plan tables — never workouts,
 * workout_exercises, or rep_goals — and once materialised, a template is
 * JUST a plan: nothing in the schema records where it came from, it
 * lists/edits/deletes/activates like anything hand-built.
 *
 * Per-exercise duration_minutes has no source in seed-plans.ts (the old
 * model never needed one) — DEFAULT_SEED_EXERCISE_DURATION_MINUTES is a
 * nominal 5min/exercise, the same honest-coarse-default pattern as
 * prefill.ts's NOMINAL_WORKOUT_MINUTES (30min/workout — every seed session
 * has 6 exercises, so this is that same number redistributed, not a new
 * guess). Editable in the builder afterward like anything else.
 */

type TypedClient = SupabaseClient<Database>;

export type TemplateKey = "starter_reps" | "plan_a" | "plan_b" | "plan_c";

const DEFAULT_SEED_EXERCISE_DURATION_MINUTES = 5;

async function findOrCreateExercise(supabase: TypedClient, userId: string, exercise: SeedExercise): Promise<string> {
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

async function findExistingPlan(supabase: TypedClient, userId: string, name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workout_plans")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .eq("archived", false)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function setActiveSlot(supabase: TypedClient, userId: string, kind: "micro" | "routine", planId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("active_workout_plans")
    .select("micro_plan_id, routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;

  const microPlanId = kind === "micro" ? planId : (existing?.micro_plan_id ?? null);
  const routinePlanId = kind === "routine" ? planId : (existing?.routine_plan_id ?? null);

  const { error } = await supabase
    .from("active_workout_plans")
    .upsert(
      { user_id: userId, micro_plan_id: microPlanId, routine_plan_id: routinePlanId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

async function materializeStarterReps(supabase: TypedClient, userId: string): Promise<string> {
  const existing = await findExistingPlan(supabase, userId, "Starter Reps");
  if (existing) return existing;

  const { data: plan, error: planError } = await supabase
    .from("workout_plans")
    .insert({ user_id: userId, name: "Starter Reps", kind: "micro" })
    .select("id")
    .single();
  if (planError) throw planError;

  const rows = [];
  for (let i = 0; i < STARTER_REP_GOALS.length; i++) {
    const goal = STARTER_REP_GOALS[i];
    const exerciseId = await findOrCreateExercise(supabase, userId, goal.exercise);
    rows.push({
      user_id: userId,
      plan_id: plan.id,
      exercise_id: exerciseId,
      position: i + 1,
      schedule_days: goal.activeDays,
      goal_type: "daily_total" as const,
      goal_value: goal.dailyTarget,
    });
  }
  const { error: insertError } = await supabase.from("plan_micro_exercises").insert(rows);
  if (insertError) throw insertError;

  return plan.id;
}

/** 0=Sun..6=Sat. weekdayWorkoutNames is Mon-Fri, index 0=Mon. */
const WEEKDAY_DAY_OF_WEEK = [1, 2, 3, 4, 5] as const;

async function materializeSessionPlan(supabase: TypedClient, userId: string, planKey: "plan_a" | "plan_b" | "plan_c"): Promise<string> {
  const seedPlan = SEED_PLANS.find((p) => p.key === planKey);
  if (!seedPlan) throw new Error(`Unknown seed plan: ${planKey}`);

  const existing = await findExistingPlan(supabase, userId, seedPlan.name);
  if (existing) return existing;

  const { data: plan, error: planError } = await supabase
    .from("workout_plans")
    .insert({ user_id: userId, name: seedPlan.name, kind: "routine" })
    .select("id")
    .single();
  if (planError) throw planError;

  const exerciseIdByName = new Map<string, string>();
  for (const workout of seedPlan.workouts) {
    for (const we of workout.exercises) {
      if (exerciseIdByName.has(we.exercise.name)) continue;
      exerciseIdByName.set(we.exercise.name, await findOrCreateExercise(supabase, userId, we.exercise));
    }
  }

  let position = 0;
  for (const workout of seedPlan.workouts) {
    const scheduleDays = WEEKDAY_DAY_OF_WEEK.filter((_, i) => seedPlan.weekdayWorkoutNames[i] === workout.name);
    if (scheduleDays.length === 0) continue;
    position += 1;

    const { data: session, error: sessionError } = await supabase
      .from("plan_sessions")
      .insert({
        user_id: userId,
        plan_id: plan.id,
        name: workout.name,
        position,
        schedule_days: scheduleDays,
        start_time: null,
      })
      .select("id")
      .single();
    if (sessionError) throw sessionError;

    const exerciseRows = workout.exercises.map((we, i) => ({
      user_id: userId,
      session_id: session.id,
      exercise_id: exerciseIdByName.get(we.exercise.name) as string,
      position: i + 1,
      duration_minutes: DEFAULT_SEED_EXERCISE_DURATION_MINUTES,
      load_lb: null,
      target_sets: we.targetSets,
      // plan_session_exercises.target_reps is a single value, not a range —
      // the seed data's targetRepsLow/High collapses to the high end (the
      // rep target to work toward, not the minimum), editable afterward.
      target_reps: we.targetRepsHigh,
    }));
    const { error: exercisesError } = await supabase.from("plan_session_exercises").insert(exerciseRows);
    if (exercisesError) throw exercisesError;
  }

  return plan.id;
}

export async function createPlanFromTemplate(key: TemplateKey): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();

  const kind: "micro" | "routine" = key === "starter_reps" ? "micro" : "routine";
  const planId =
    key === "starter_reps"
      ? await materializeStarterReps(supabase, userId)
      : await materializeSessionPlan(supabase, userId, key);

  await setActiveSlot(supabase, userId, kind, planId);
  await syncWorkoutScheduleForActiveRoutine(supabase, userId, { clearIfInactive: kind === "routine" });

  revalidatePath("/fitness/workouts");
  revalidatePath("/fitness");
  revalidatePath("/");
  return { id: planId };
}
