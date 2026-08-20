import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, dayOfWeekFromDateString, addDaysToDateString } from "@/lib/date-utils";
import { weeklyVolume, type MuscleGroup } from "@/lib/fitness/volume";
import { loadWorkoutDetails, type DayWorkout } from "@/lib/fitness/load-workout-details";
import { FitnessDayView } from "@/components/fitness/fitness-day-view";
import type { DayCell } from "@/components/fitness/day-picker-strip";
import { VolumeHero } from "@/components/fitness/volume-hero";
import { BodyModule } from "@/components/fitness/body-module";
import { DailyChecks } from "@/components/fitness/daily-checks";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { confirmWorkoutSession, assignWorkoutToDay, ensureDailyCheckHabits, toggleDailyCheck } from "./actions";

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

  const workoutsById = await loadWorkoutDetails(supabase, userId, assignedWorkoutIds);

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

  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);
  const [{ data: weightRows }, { data: waistRow }, dailyCheckHabitIds] = await Promise.all([
    supabase
      .from("body_metrics")
      .select("weight_lb")
      .eq("user_id", userId)
      .not("weight_lb", "is", null)
      .gte("date", sevenDaysAgoStr)
      .lte("date", dateStr),
    supabase
      .from("body_metrics")
      .select("waist_in, date")
      .eq("user_id", userId)
      .not("waist_in", "is", null)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ensureDailyCheckHabits(),
  ]);

  const weightValues = (weightRows ?? []).map((r) => r.weight_lb as number);
  const weightAvg7d =
    weightValues.length > 0 ? Math.round((weightValues.reduce((a, b) => a + b, 0) / weightValues.length) * 10) / 10 : null;
  const waist = waistRow ? { valueIn: waistRow.waist_in as number, date: waistRow.date } : null;

  const { data: todayHabitLogs } = await supabase
    .from("habit_logs")
    .select("habit_id, completed")
    .in("habit_id", [dailyCheckHabitIds.protein, dailyCheckHabitIds.steps])
    .eq("date", dateStr);
  const proteinDone = todayHabitLogs?.some((l) => l.habit_id === dailyCheckHabitIds.protein && l.completed) ?? false;
  const stepsDone = todayHabitLogs?.some((l) => l.habit_id === dailyCheckHabitIds.steps && l.completed) ?? false;

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel title="Body">
            <BodyModule weightAvg7d={weightAvg7d} waist={waist} />
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Daily checks">
            <DailyChecks
              proteinDone={proteinDone}
              stepsDone={stepsDone}
              onToggle={toggleDailyCheck.bind(null, dateStr)}
            />
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
