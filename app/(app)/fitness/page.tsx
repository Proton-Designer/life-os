import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, dayOfWeekFromDateString } from "@/lib/date-utils";
import { weeklyVolume, type MuscleGroup } from "@/lib/fitness/volume";
import { FitnessDayView, type DayWorkout } from "@/components/fitness/fitness-day-view";
import type { DayCell } from "@/components/fitness/day-picker-strip";
import { VolumeHero } from "@/components/fitness/volume-hero";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { confirmWorkoutSession, assignWorkoutToDay } from "./actions";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function FitnessPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);
  const todayDayOfWeek = dayOfWeekFromDateString(dateStr);

  const [{ data: scheduleRows }, { data: confirmedRows }, { data: savedWorkoutRows }] = await Promise.all([
    supabase
      .from("workout_schedule")
      .select("day_of_week, workout_id, workouts(id, name)")
      .eq("user_id", userId)
      .in("day_of_week", [1, 2, 3, 4, 5]),
    supabase
      .from("workout_sessions")
      .select("id, date, workout_id, session_sets(exercise_id, sets, reps, load, exercises(primary_muscles, secondary_muscles))")
      .eq("user_id", userId)
      .eq("source", "confirmed")
      .gte("date", weekDates[0])
      .lte("date", weekDates[6]),
    supabase.from("workouts").select("id, name").eq("user_id", userId).eq("archived", false).order("name"),
  ]);

  const assignedWorkoutIds = Array.from(
    new Set((scheduleRows ?? []).map((r) => r.workout_id).filter((id): id is string => id !== null))
  );

  const { data: workoutDetailRows } =
    assignedWorkoutIds.length > 0
      ? await supabase
          .from("workouts")
          .select(
            "id, name, workout_exercises(exercise_id, position, target_sets, target_reps_low, target_reps_high, target_load, exercises(name, primary_muscles, secondary_muscles))"
          )
          .in("id", assignedWorkoutIds)
      : { data: [] };

  const exerciseIdsInPlay = Array.from(
    new Set(
      (workoutDetailRows ?? []).flatMap((w) => (w.workout_exercises ?? []).map((we) => we.exercise_id))
    )
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

  const workoutsById = new Map<string, DayWorkout>();
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

  const scheduleByDay = new Map(
    (scheduleRows ?? []).map((r) => [r.day_of_week, { workoutId: r.workout_id, workoutName: r.workouts?.name ?? null }])
  );

  const days: DayCell[] = [1, 2, 3, 4, 5].map((dayOfWeek) => {
    const entry = scheduleByDay.get(dayOfWeek);
    return {
      dayOfWeek,
      label: WEEKDAY_LABELS[dayOfWeek],
      workoutId: entry?.workoutId ?? null,
      workoutName: entry?.workoutName ?? null,
    };
  });

  const dates: Record<number, string> = {};
  const dayLabels: Record<number, string> = {};
  for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
    dates[dayOfWeek] = weekDates[dayOfWeek];
    dayLabels[dayOfWeek] = WEEKDAY_LABELS[dayOfWeek];
  }

  const workoutsByDay: Record<number, DayWorkout | null> = {};
  const confirmedByDay: Record<number, boolean> = {};
  for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
    const workoutId = scheduleByDay.get(dayOfWeek)?.workoutId ?? null;
    workoutsByDay[dayOfWeek] = workoutId ? (workoutsById.get(workoutId) ?? null) : null;
    confirmedByDay[dayOfWeek] = workoutId
      ? (confirmedRows ?? []).some((s) => s.date === dates[dayOfWeek] && s.workout_id === workoutId)
      : false;
  }

  const scheduledDaysThisWeek = days.filter((d) => d.workoutId !== null).length;
  const confirmedDaysThisWeek = Object.values(confirmedByDay).filter(Boolean).length;

  const volume = weeklyVolume(
    (confirmedRows ?? []).flatMap((session) =>
      (session.session_sets ?? []).map((s) => ({
        sets: s.sets,
        primaryMuscles: (s.exercises?.primary_muscles ?? []) as MuscleGroup[],
        secondaryMuscles: (s.exercises?.secondary_muscles ?? []) as MuscleGroup[],
      }))
    )
  );

  return (
    <PageContainer>
      <PageHeader title="Fitness" />

      <Link
        href="/fitness/workouts"
        className="min-h-11 rounded-lg border border-border/60 px-4 py-2.5 text-sm font-medium hover:bg-muted"
      >
        My Workouts →
      </Link>

      <Panel title="This week">
        <VolumeHero
          volume={volume}
          adherence={scheduledDaysThisWeek > 0 ? { confirmed: confirmedDaysThisWeek, scheduled: scheduledDaysThisWeek } : null}
        />
      </Panel>

      <Panel title="Sessions">
        <FitnessDayView
          days={days}
          dates={dates}
          dayLabels={dayLabels}
          todayDayOfWeek={todayDayOfWeek}
          workoutsByDay={workoutsByDay}
          confirmedByDay={confirmedByDay}
          savedWorkouts={savedWorkoutRows ?? []}
          onConfirm={confirmWorkoutSession}
          onAssign={assignWorkoutToDay}
        />
      </Panel>
    </PageContainer>
  );
}
