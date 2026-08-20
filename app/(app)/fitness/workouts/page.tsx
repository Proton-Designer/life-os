import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { WorkoutsClient, type FullWorkout } from "@/components/fitness/workouts-client";
import { StarterPlanToggle } from "@/components/fitness/starter-plan-toggle";
import type { ExerciseOption } from "@/components/fitness/exercise-picker";
import type { MuscleGroup } from "@/lib/fitness/volume";
import { SEED_PLANS } from "@/lib/fitness/seed-plans";
import {
  createExercise,
  createWorkoutWithExercises,
  saveWorkout,
  duplicateWorkout,
  renameWorkout,
  archiveWorkout,
} from "./actions";
import { adoptSessionPlan, adoptStarterPlan } from "../adopt-plan-action";

const SEED_PLAN_DESCRIPTIONS: Record<(typeof SEED_PLANS)[number]["key"], string> = {
  plan_a: "Every session touches push, pull and delts — highest frequency, lowest per-session dose.",
  plan_b: "Fewer, bigger touches — each muscle worked about twice a week at higher volume per touch.",
  plan_c: "Trains what push-ups and pull-ups don't — delts and core every session, chest and lats held low.",
};

export default async function WorkoutsPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const [{ data: exerciseRows }, { data: workoutRows }, { count: repGoalCount }] = await Promise.all([
    supabase
      .from("exercises")
      .select("id, name, primary_muscles, secondary_muscles")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("workouts")
      .select("id, name, workout_exercises(exercise_id, position, target_sets, target_reps_low, target_reps_high, target_load, exercises(name, primary_muscles, secondary_muscles))")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("rep_goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("archived", false),
  ]);
  const starterPlanAdopted = (repGoalCount ?? 0) > 0;

  const exercises: ExerciseOption[] = (exerciseRows ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscles: (e.primary_muscles ?? []) as MuscleGroup[],
    secondaryMuscles: (e.secondary_muscles ?? []) as MuscleGroup[],
  }));

  const workouts: FullWorkout[] = (workoutRows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    exercises: (w.workout_exercises ?? [])
      .sort((a, b) => a.position - b.position)
      .map((we, i) => ({
        key: `${w.id}-${we.position}-${i}`,
        exerciseId: we.exercise_id,
        name: we.exercises?.name ?? "",
        primaryMuscles: (we.exercises?.primary_muscles ?? []) as MuscleGroup[],
        secondaryMuscles: (we.exercises?.secondary_muscles ?? []) as MuscleGroup[],
        targetSets: we.target_sets,
        targetRepsLow: we.target_reps_low,
        targetRepsHigh: we.target_reps_high,
        targetLoad: we.target_load,
      })),
  }));

  return (
    <PageContainer>
      <PageHeader title="My Workouts" />
      <Link href="/fitness" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Back to Fitness
      </Link>
      <StarterPlanToggle adopted={starterPlanAdopted} onAdopt={adoptStarterPlan} />
      <WorkoutsClient
        exercises={exercises}
        workouts={workouts}
        seedPlans={SEED_PLANS.map((p) => ({ id: p.key, name: p.name, description: SEED_PLAN_DESCRIPTIONS[p.key] }))}
        onCreateExercise={createExercise}
        onSaveNew={createWorkoutWithExercises}
        onSaveExisting={saveWorkout}
        onDuplicate={duplicateWorkout}
        onRename={renameWorkout}
        onArchive={archiveWorkout}
        onAdoptPlan={adoptSessionPlan}
      />
    </PageContainer>
  );
}
