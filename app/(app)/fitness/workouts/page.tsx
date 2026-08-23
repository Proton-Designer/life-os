import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { PlanWorkoutsClient } from "@/components/fitness/workouts/plan-workouts-client";
import type { ExerciseOption } from "@/components/fitness/exercise-picker";
import type { ActivePlans, PlanDraft } from "@/lib/fitness/plan-types";
import type { MuscleGroup } from "@/lib/fitness/volume";
import { createExercise } from "./actions";
import { savePlan, deletePlan, activatePlan, deactivateSlot } from "./plan-actions";
import { createPlanFromTemplate } from "./template-actions";

export default async function WorkoutsPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const [{ data: exerciseRows }, { data: planRows }, { data: activeRow }] = await Promise.all([
    supabase
      .from("exercises")
      .select("id, name, primary_muscles, secondary_muscles")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("workout_plans")
      .select(
        `id, name, kind,
         plan_micro_exercises(id, exercise_id, position, schedule_days, goal_type, goal_value, notes, exercises(name)),
         plan_sessions(id, name, position, schedule_days, start_time,
           plan_session_exercises(id, exercise_id, position, duration_minutes, load_lb, target_sets, target_reps, exercises(name)))`
      )
      .eq("user_id", userId)
      .eq("archived", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("active_workout_plans")
      .select("micro_plan_id, routine_plan_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const exercises: ExerciseOption[] = (exerciseRows ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscles: (e.primary_muscles ?? []) as MuscleGroup[],
    secondaryMuscles: (e.secondary_muscles ?? []) as MuscleGroup[],
  }));

  const plans: PlanDraft[] = (planRows ?? []).map((row) => {
    if (row.kind === "micro") {
      return {
        kind: "micro",
        id: row.id,
        name: row.name,
        exercises: (row.plan_micro_exercises ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((ex) => ({
            id: ex.id,
            exerciseId: ex.exercise_id,
            name: ex.exercises?.name ?? "",
            scheduleDays: ex.schedule_days ?? [],
            goalType: ex.goal_type as "daily_total" | "frequency",
            goalValue: ex.goal_value,
            notes: ex.notes,
          })),
      };
    }
    return {
      kind: "routine",
      id: row.id,
      name: row.name,
      sessions: (row.plan_sessions ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((session) => ({
          id: session.id,
          name: session.name,
          scheduleDays: session.schedule_days ?? [],
          // Postgres `time` columns come back as "HH:MM:SS" — every
          // consumer of SessionDraft.startTime (day-grid.ts's
          // minutesFromMidnight strictly, the <input type="time"> in
          // routine-builder.tsx implicitly) expects "HH:MM" and the
          // former THROWS on the extra seconds. Caught live, 2026-08-23:
          // editing/previewing any session with a start time crashed
          // HourlyWeekCalendar outright.
          startTime: session.start_time ? session.start_time.slice(0, 5) : null,
          exercises: (session.plan_session_exercises ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((ex) => ({
              id: ex.id,
              exerciseId: ex.exercise_id,
              name: ex.exercises?.name ?? "",
              durationMinutes: ex.duration_minutes,
              loadLb: ex.load_lb,
              targetSets: ex.target_sets,
              targetReps: ex.target_reps,
            })),
        })),
    };
  });

  const activePlans: ActivePlans = {
    microPlanId: activeRow?.micro_plan_id ?? null,
    routinePlanId: activeRow?.routine_plan_id ?? null,
  };

  return (
    <PageContainer>
      <PageHeader title="My Workouts" />
      <Link href="/fitness" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Back to Fitness
      </Link>
      <PlanWorkoutsClient
        initialPlans={plans}
        initialActivePlans={activePlans}
        allExercises={exercises}
        onCreateExercise={createExercise}
        savePlan={savePlan}
        deletePlan={deletePlan}
        activatePlan={activatePlan}
        deactivateSlot={deactivateSlot}
        createPlanFromTemplate={createPlanFromTemplate}
      />
    </PageContainer>
  );
}
