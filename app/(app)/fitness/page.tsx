import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, dayOfWeekFromDateString, addDaysToDateString } from "@/lib/date-utils";
import { weeklyVolume, type MuscleGroup } from "@/lib/fitness/volume";
import { cycleForDate, isInBenchmarkWindow } from "@/lib/fitness/cycle";
import { weekDayStatus } from "@/lib/fitness/week-status";
import { buildDailyLog, pendingDailyLog, type DailyLogInputs } from "@/lib/fitness/daily-log";
import { loadPlanSessionDetails, type PlanSessionDetail } from "@/lib/fitness/load-plan-session-details";
import { VolumeHero } from "@/components/fitness/volume-hero";
import { ThisWeekCalendar, type ThisWeekDay } from "@/components/fitness/this-week-calendar";
import { DailyLogPanel } from "@/components/fitness/daily-log-panel";
import { CycleProgressPanel, type BenchmarkDelta } from "@/components/fitness/cycle-progress-panel";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import {
  confirmPlanSession,
  ensureDailyCheckHabits,
  toggleDailyCheck,
  logWeight,
  logWaist,
  quickLogExercise,
  logCycleBenchmark,
} from "./actions";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BENCHMARK_WINDOW_DAYS = 3;

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

  // --- Active plans: the Workout Plan strip's source of truth -----------
  const { data: activeRow } = await supabase
    .from("active_workout_plans")
    .select("micro_plan_id, routine_plan_id")
    .eq("user_id", userId)
    .maybeSingle();
  const microPlanId = activeRow?.micro_plan_id ?? null;
  const routinePlanId = activeRow?.routine_plan_id ?? null;

  const planIds = [microPlanId, routinePlanId].filter((id): id is string => id !== null);
  const { data: planRows } =
    planIds.length > 0 ? await supabase.from("workout_plans").select("id, name").in("id", planIds) : { data: [] };
  const planNameById = new Map((planRows ?? []).map((p) => [p.id, p.name]));
  const activePlanNames = [microPlanId, routinePlanId]
    .map((id) => (id ? planNameById.get(id) : null))
    .filter((name): name is string => !!name);

  // --- Active micro plan's exercises (all schedule_days — used by both
  // Daily Log's today filter and This Week's per-day expansion) ---------
  const { data: microExerciseRows } = microPlanId
    ? await supabase
        .from("plan_micro_exercises")
        .select("exercise_id, schedule_days, goal_type, goal_value, notes, exercises(name)")
        .eq("plan_id", microPlanId)
        .order("position")
    : { data: [] };

  // --- Active routine plan's sessions (all schedule_days) ---------------
  const { data: sessionRows } = routinePlanId
    ? await supabase
        .from("plan_sessions")
        .select("id, name, schedule_days, start_time, plan_session_exercises(duration_minutes)")
        .eq("plan_id", routinePlanId)
        .order("position")
    : { data: [] };
  const sessions = (sessionRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    scheduleDays: s.schedule_days,
    startTime: s.start_time,
    durationMinutes: (s.plan_session_exercises ?? []).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0),
  }));

  // --- Today's logged sets (micro progress) and the week's confirmed
  // plan-session dates (This Week's status + Daily Log's confirmedToday) -
  const [{ data: todaySetRows }, { data: weekConfirmedRows }, sessionDetailsById] = await Promise.all([
    supabase
      .from("session_sets")
      .select("exercise_id, sets, reps, workout_sessions!inner(date, user_id)")
      .eq("workout_sessions.user_id", userId)
      .eq("workout_sessions.date", dateStr),
    supabase
      .from("workout_sessions")
      .select("date, plan_session_id")
      .eq("user_id", userId)
      .eq("source", "confirmed")
      .not("plan_session_id", "is", null)
      .gte("date", weekDates[0])
      .lte("date", weekDates[6]),
    loadPlanSessionDetails(
      supabase,
      userId,
      sessions.filter((s) => s.scheduleDays.includes(todayDayOfWeek)).map((s) => s.id)
    ),
  ]);

  const todayTotalByExercise = new Map<string, number>();
  const todayBoutsByExercise = new Map<string, number>();
  for (const row of todaySetRows ?? []) {
    if (!row.exercise_id) continue;
    todayTotalByExercise.set(row.exercise_id, (todayTotalByExercise.get(row.exercise_id) ?? 0) + row.sets * row.reps);
    todayBoutsByExercise.set(row.exercise_id, (todayBoutsByExercise.get(row.exercise_id) ?? 0) + 1);
  }

  const confirmedByDateAndSession = new Set((weekConfirmedRows ?? []).map((r) => `${r.date}:${r.plan_session_id}`));

  // --- Cycle anchor: defaults to today on first read (logic-gap
  // resolution #6 — "default the anchor to the first plan activation
  // date"). Persisted lazily here rather than at plan-activation time
  // (simpler than threading it through 3 separate action files) — an
  // insert-if-missing, idempotent on the primary key. --------------------
  const { data: anchorRow } = await supabase.from("fitness_cycle_anchor").select("anchor_date").eq("user_id", userId).maybeSingle();
  let anchorDate = anchorRow?.anchor_date ?? null;
  if (!anchorDate) {
    anchorDate = dateStr;
    await supabase.from("fitness_cycle_anchor").upsert({ user_id: userId, anchor_date: anchorDate }, { onConflict: "user_id" });
  }
  const cycle = cycleForDate(anchorDate, dateStr);

  // --- Benchmark exercises: whatever the active micro plan references
  // (typically pull-ups/push-ups) — logCycleBenchmark works for any set. --
  const benchmarkExercises = (microExerciseRows ?? []).map((e) => ({ exerciseId: e.exercise_id, name: e.exercises?.name ?? "" }));

  const [{ data: benchmarkRows }, { data: weightRows }, { data: waistRow }, dailyCheckHabitIds] = await Promise.all([
    benchmarkExercises.length > 0
      ? supabase
          .from("fitness_benchmarks")
          .select("exercise_id, date, max_reps")
          .eq("user_id", userId)
          .in(
            "exercise_id",
            benchmarkExercises.map((e) => e.exerciseId)
          )
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("body_metrics")
      .select("weight_lb, date")
      .eq("user_id", userId)
      .not("weight_lb", "is", null)
      .gte("date", addDaysToDateString(dateStr, -6))
      .lte("date", dateStr)
      .order("date", { ascending: false }),
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
  const daysSinceWaist = waist ? Math.floor((new Date(`${dateStr}T00:00:00Z`).getTime() - new Date(`${waist.date}T00:00:00Z`).getTime()) / 86_400_000) : null;
  const waistDue = daysSinceWaist === null || daysSinceWaist >= 14;
  const weightLoggedToday = (weightRows ?? []).some((r) => r.date === dateStr);

  const { data: todayHabitLogs } = await supabase
    .from("habit_logs")
    .select("habit_id, completed")
    .in("habit_id", [dailyCheckHabitIds.protein, dailyCheckHabitIds.steps])
    .eq("date", dateStr);
  const proteinDone = todayHabitLogs?.some((l) => l.habit_id === dailyCheckHabitIds.protein && l.completed) ?? false;
  const stepsDone = todayHabitLogs?.some((l) => l.habit_id === dailyCheckHabitIds.steps && l.completed) ?? false;

  // Deltas: most recent benchmark strictly before this cycle's start vs
  // the most recent on/after it — "vs previous cycle" per the spec's
  // confirmed decision, not a running all-time PR.
  const deltas: BenchmarkDelta[] = benchmarkExercises.map((ex) => {
    const rows = (benchmarkRows ?? []).filter((r) => r.exercise_id === ex.exerciseId);
    const current = rows.find((r) => r.date >= cycle.startDate)?.max_reps ?? null;
    const previous = rows.find((r) => r.date < cycle.startDate)?.max_reps ?? null;
    return { exerciseId: ex.exerciseId, name: ex.name, current, previous };
  });

  const benchmarkAlreadyLoggedThisWindow = (benchmarkRows ?? []).some(
    (r) => r.date >= addDaysToDateString(cycle.endDate, -(BENCHMARK_WINDOW_DAYS - 1))
  );

  // --- Daily Log ----------------------------------------------------------
  const microToday = (microExerciseRows ?? []).filter((e) => e.schedule_days.includes(todayDayOfWeek));
  const dailyLogInputs: DailyLogInputs = {
    microTotals: microToday
      .filter((e) => e.goal_type === "daily_total")
      .map((e) => ({
        exerciseId: e.exercise_id,
        name: e.exercises?.name ?? "",
        target: e.goal_value,
        loggedToday: todayTotalByExercise.get(e.exercise_id) ?? 0,
        notes: e.notes,
      })),
    microFreqs: microToday
      .filter((e) => e.goal_type === "frequency")
      .map((e) => ({
        exerciseId: e.exercise_id,
        name: e.exercises?.name ?? "",
        target: e.goal_value,
        boutsToday: todayBoutsByExercise.get(e.exercise_id) ?? 0,
        notes: e.notes,
      })),
    sessions: sessions
      .filter((s) => s.scheduleDays.includes(todayDayOfWeek))
      .map((s) => ({
        sessionId: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        startTime: s.startTime,
        confirmedToday: confirmedByDateAndSession.has(`${dateStr}:${s.id}`),
      })),
    dailyChecks: [
      { checkKind: "protein", done: proteinDone },
      { checkKind: "steps", done: stepsDone },
    ],
    bodyMetrics: [
      { metric: "weight", lastValue: weightValues[0] ?? null, lastDate: null, dueToday: !weightLoggedToday },
      { metric: "waist", lastValue: waist?.valueIn ?? null, lastDate: waist?.date ?? null, dueToday: waistDue },
    ],
    benchmark:
      isInBenchmarkWindow(cycle, BENCHMARK_WINDOW_DAYS) && !benchmarkAlreadyLoggedThisWindow
        ? { cycleNumber: cycle.cycleNumber, dueBy: cycle.endDate }
        : null,
  };
  const pendingItems = pendingDailyLog(buildDailyLog(dailyLogInputs));

  const sessionDetailsBySessionId: Record<string, { exercises: PlanSessionDetail["exercises"] }> = {};
  for (const [id, detail] of sessionDetailsById) sessionDetailsBySessionId[id] = { exercises: detail.exercises };

  // --- This week ------------------------------------------------------
  const thisWeekDays: ThisWeekDay[] = weekDates.map((date, i) => {
    const dow = i;
    const microItems = (microExerciseRows ?? [])
      .filter((e) => e.schedule_days.includes(dow))
      .map((e) => ({
        name: e.exercises?.name ?? "",
        goalLabel: e.goal_type === "daily_total" ? `${e.goal_value} reps` : `${e.goal_value}x`,
      }));
    const daySessions = sessions
      .filter((s) => s.scheduleDays.includes(dow))
      .map((s) => ({
        name: s.name,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        confirmed: confirmedByDateAndSession.has(`${date}:${s.id}`),
      }));
    const status =
      daySessions.length > 0 ? weekDayStatus(date, dateStr, daySessions.every((s) => s.confirmed)) : null;
    return { dateStr: date, dayLabel: WEEKDAY_LABELS[dow], isToday: date === dateStr, microItems, sessions: daySessions, status };
  });

  const weekConfirmedSessionCount = new Set(weekConfirmedRows?.map((r) => `${r.date}:${r.plan_session_id}`)).size;
  const weekScheduledSessionCount = weekDates.reduce(
    (sum, date, i) => sum + sessions.filter((s) => s.scheduleDays.includes(i)).length,
    0
  );

  const { data: confirmedSetRows } = await supabase
    .from("workout_sessions")
    .select("session_sets(exercise_id, sets, exercises(primary_muscles, secondary_muscles))")
    .eq("user_id", userId)
    .eq("source", "confirmed")
    .gte("date", weekDates[0])
    .lte("date", weekDates[6]);
  const volume = weeklyVolume(
    (confirmedSetRows ?? []).flatMap((session) =>
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

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-2.5">
        <span className="min-w-0 truncate text-sm font-medium">
          Workout Plan: {activePlanNames.length > 0 ? activePlanNames.join(" + ") : "none selected"}
        </span>
        <Link
          href="/fitness/workouts"
          className={
            activePlanNames.length === 0
              ? "min-h-11 shrink-0 rounded-lg bg-accent-fitness px-4 py-2.5 text-sm font-medium text-background hover:opacity-90"
              : "min-h-11 shrink-0 rounded-lg border border-border/60 px-4 py-2.5 text-sm font-medium hover:bg-muted"
          }
        >
          My Workouts →
        </Link>
      </div>

      <Panel title="Daily Log">
        <DailyLogPanel
          date={dateStr}
          items={pendingItems}
          sessionDetailsBySessionId={sessionDetailsBySessionId}
          benchmarkExercises={benchmarkExercises}
          onLogExercise={quickLogExercise.bind(null, dateStr)}
          onConfirmSession={confirmPlanSession}
          onToggleDailyCheck={toggleDailyCheck.bind(null, dateStr)}
          onLogWeight={logWeight.bind(null, dateStr)}
          onLogWaist={logWaist.bind(null, dateStr)}
          onLogBenchmark={logCycleBenchmark.bind(null, dateStr)}
        />
      </Panel>

      <Panel title="This week">
        <div className="flex flex-col gap-4">
          <VolumeHero
            volume={volume}
            adherence={weekScheduledSessionCount > 0 ? { confirmed: weekConfirmedSessionCount, scheduled: weekScheduledSessionCount } : null}
          />
          <ThisWeekCalendar days={thisWeekDays} />
        </div>
      </Panel>

      <Panel title="Cycle Progress checks">
        <CycleProgressPanel
          cycleNumber={cycle.cycleNumber}
          daysLeft={cycle.daysLeft}
          weightAvg7d={weightAvg7d}
          waist={waist}
          deltas={deltas}
          benchmarkExercises={benchmarkExercises}
          onLogBenchmark={logCycleBenchmark.bind(null, dateStr)}
        />
      </Panel>
    </PageContainer>
  );
}
