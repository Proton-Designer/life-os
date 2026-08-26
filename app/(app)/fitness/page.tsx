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
import { BodyModule } from "@/components/fitness/body-module";
import { CycleProgressPanel, type BenchmarkDelta } from "@/components/fitness/cycle-progress-panel";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { confirmPlanSession, logWeight, logWaist, quickLogExercise, logCycleBenchmark } from "./actions";

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
    planIds.length > 0 ? await supabase.from("workout_plans").select("id, name, created_at").in("id", planIds) : { data: [] };
  const planNameById = new Map((planRows ?? []).map((p) => [p.id, p.name]));
  const activePlanNames = [microPlanId, routinePlanId]
    .map((id) => (id ? planNameById.get(id) : null))
    .filter((name): name is string => !!name);

  // This Week's floor (2026-08-22 review catch): a day before the plan
  // supplying its items even EXISTED cannot be Missed — activating Starter
  // Reps on a Thursday night must not retroactively accuse Monday–Wednesday
  // of failure. Floored per-plan (not per-user) because a routine plan
  // activated later than the micro plan must not inherit the micro plan's
  // longer history, and vice versa. Local date, not UTC — same class of bug
  // as everything else that's touched a calendar date in this build. The
  // plan's own creation DAY counts as "existed" even if created at 22:50 —
  // one real hour of the day is still real; this is a deliberate choice,
  // not an oversight (the Lead's ruling, 2026-08-22).
  const planCreatedLocalDate = (planId: string | null): string | null => {
    if (!planId) return null;
    const createdAt = planRows?.find((p) => p.id === planId)?.created_at;
    return createdAt ? localDateString(new Date(createdAt), timezone) : null;
  };
  const microPlanStartDate = planCreatedLocalDate(microPlanId);
  const routinePlanStartDate = planCreatedLocalDate(routinePlanId);

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
    // Postgres `time` -> "HH:MM:SS"; display wants "HH:MM" (same fix as
    // workouts/page.tsx's identical read).
    startTime: s.start_time ? s.start_time.slice(0, 5) : null,
    durationMinutes: (s.plan_session_exercises ?? []).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0),
  }));

  // --- The week's logged sets (micro progress, today AND every other day
  // — This Week needs per-day micro completion, not just today's) and the
  // week's confirmed plan-session dates (This Week's status + Daily Log's
  // confirmedToday) ------------------------------------------------------
  const [{ data: weekSetRows }, { data: weekConfirmedRows }, sessionDetailsById] = await Promise.all([
    supabase
      .from("session_sets")
      .select("exercise_id, sets, reps, workout_sessions!inner(date, user_id)")
      .eq("workout_sessions.user_id", userId)
      .gte("workout_sessions.date", weekDates[0])
      .lte("workout_sessions.date", weekDates[6]),
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

  // Keyed `${date}:${exerciseId}` — This Week's per-day micro completion
  // needs every day in the range, not just today; today's Daily Log
  // aggregates below are just this same map filtered to dateStr.
  const totalByDateExercise = new Map<string, number>();
  const boutsByDateExercise = new Map<string, number>();
  for (const row of weekSetRows ?? []) {
    if (!row.exercise_id) continue;
    const key = `${row.workout_sessions.date}:${row.exercise_id}`;
    totalByDateExercise.set(key, (totalByDateExercise.get(key) ?? 0) + row.sets * row.reps);
    boutsByDateExercise.set(key, (boutsByDateExercise.get(key) ?? 0) + 1);
  }
  const todayTotalByExercise = new Map<string, number>();
  const todayBoutsByExercise = new Map<string, number>();
  for (const row of weekSetRows ?? []) {
    if (!row.exercise_id || row.workout_sessions.date !== dateStr) continue;
    todayTotalByExercise.set(row.exercise_id, (todayTotalByExercise.get(row.exercise_id) ?? 0) + row.sets * row.reps);
    todayBoutsByExercise.set(row.exercise_id, (todayBoutsByExercise.get(row.exercise_id) ?? 0) + 1);
  }

  const confirmedByDateAndSession = new Set((weekConfirmedRows ?? []).map((r) => `${r.date}:${r.plan_session_id}`));

  // --- Cycle anchor: defaults to the active plan's own true start date on
  // first read WHERE A PLAN IS ACTIVE (logic-gap resolution #6; 2026-08-22
  // review catch — anchoring on a plan-less visit makes Cycle 1
  // meaningless from the start; anchoring on "today" rather than the
  // plan's real created_at drifts the same way the This Week floor bug
  // did, just smaller). Persisted lazily here rather than at
  // plan-activation time (simpler than threading it through 3 separate
  // action files) — an insert-if-missing, idempotent on the primary key.
  // THIS IS A WRITE ON A READ PATH — do not "simplify" it into a plain
  // select; a page view is what creates the anchor row the first time a
  // plan is active.
  //
  // GATING THE READ, NOT JUST THE INSERT (2026-08-23 review catch): an
  // anchor row can outlive the plan that created it — deactivating a plan
  // does NOT delete the anchor (real cycle history for someone who comes
  // back later shouldn't get re-anchored to whenever they happen to
  // reopen the app). That means `hasActivePlan` alone decided whether to
  // WRITE a new anchor, but a stale anchor from a now-inactive plan (or
  // one that predates this gate entirely) would still render a cycle with
  // nothing active — the exact fabricated-Cycle-1 bug, via a second path.
  // `cycle` is therefore null whenever there's no active plan, full stop,
  // regardless of whether an anchor row exists. -----------------------------
  const hasActivePlan = microPlanId !== null || routinePlanId !== null;
  const { data: anchorRow } = await supabase.from("fitness_cycle_anchor").select("anchor_date").eq("user_id", userId).maybeSingle();
  let anchorDate = anchorRow?.anchor_date ?? null;
  if (!anchorDate && hasActivePlan) {
    const planStartDates = [microPlanStartDate, routinePlanStartDate].filter((d): d is string => d !== null).sort();
    anchorDate = planStartDates[0] ?? dateStr;
    await supabase.from("fitness_cycle_anchor").upsert({ user_id: userId, anchor_date: anchorDate }, { onConflict: "user_id" });
  }
  const cycle = anchorDate && hasActivePlan ? cycleForDate(anchorDate, dateStr) : null;

  // --- Benchmark exercises: whatever the active micro plan references
  // (typically pull-ups/push-ups) — logCycleBenchmark works for any set. --
  const benchmarkExercises = (microExerciseRows ?? []).map((e) => ({ exerciseId: e.exercise_id, name: e.exercises?.name ?? "" }));

  const [{ data: benchmarkRows }, { data: weightRows }, { data: waistRow }] = await Promise.all([
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
  ]);

  const weightValues = (weightRows ?? []).map((r) => r.weight_lb as number);
  const weightAvg7d =
    weightValues.length > 0 ? Math.round((weightValues.reduce((a, b) => a + b, 0) / weightValues.length) * 10) / 10 : null;
  const waist = waistRow ? { valueIn: waistRow.waist_in as number, date: waistRow.date } : null;

  // Deltas: most recent benchmark strictly before this cycle's start vs
  // the most recent on/after it — "vs previous cycle" per the spec's
  // confirmed decision, not a running all-time PR.
  const deltas: BenchmarkDelta[] = cycle
    ? benchmarkExercises.map((ex) => {
        const rows = (benchmarkRows ?? []).filter((r) => r.exercise_id === ex.exerciseId);
        const current = rows.find((r) => r.date >= cycle.startDate)?.max_reps ?? null;
        const previous = rows.find((r) => r.date < cycle.startDate)?.max_reps ?? null;
        return { exerciseId: ex.exerciseId, name: ex.name, current, previous };
      })
    : [];

  const benchmarkAlreadyLoggedThisWindow = cycle
    ? (benchmarkRows ?? []).some((r) => r.date >= addDaysToDateString(cycle.endDate, -(BENCHMARK_WINDOW_DAYS - 1)))
    : false;

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
    benchmark:
      cycle && isInBenchmarkWindow(cycle, BENCHMARK_WINDOW_DAYS) && !benchmarkAlreadyLoggedThisWindow
        ? { cycleNumber: cycle.cycleNumber, dueBy: cycle.endDate }
        : null,
  };
  const pendingItems = pendingDailyLog(buildDailyLog(dailyLogInputs));

  const sessionDetailsBySessionId: Record<string, { exercises: PlanSessionDetail["exercises"] }> = {};
  for (const [id, detail] of sessionDetailsById) sessionDetailsBySessionId[id] = { exercises: detail.exercises };

  // --- This week ------------------------------------------------------
  // Micro-goal completion is a per-day binary too (2026-08-22 review catch
  // — "30 pull-ups TODAY... resets at midnight, that IS a single-day
  // binary"), computed the same way pendingDailyLog decides done-ness:
  // daily_total against the day's summed reps, frequency against the
  // day's bout count. A day is `completed` only when BOTH every scheduled
  // micro goal AND every scheduled session are done — partial progress on
  // either is not completed. This matters concretely: Ayman's live
  // configuration is Starter Reps (micro-only, no routine plan), so
  // without this, This Week would show no status on any day for the only
  // plan he actually runs.
  const dayMicroDoneFor = (dayScheduledMicro: NonNullable<typeof microExerciseRows>, date: string): boolean =>
    dayScheduledMicro.every((e) => {
      const done = e.goal_type === "daily_total" ? (totalByDateExercise.get(`${date}:${e.exercise_id}`) ?? 0) : (boutsByDateExercise.get(`${date}:${e.exercise_id}`) ?? 0);
      return done >= e.goal_value;
    });

  const thisWeekDays: ThisWeekDay[] = weekDates.map((date, i) => {
    const dow = i;
    // Days before the plan's own creation date have nothing scheduled —
    // the plan didn't exist yet, so there is nothing to show or judge.
    const microPlanExistedThisDay = microPlanStartDate !== null && date >= microPlanStartDate;
    const routinePlanExistedThisDay = routinePlanStartDate !== null && date >= routinePlanStartDate;
    const dayMicroExercises = microPlanExistedThisDay
      ? (microExerciseRows ?? []).filter((e) => e.schedule_days.includes(dow))
      : [];
    const microItems = dayMicroExercises.map((e) => ({
      name: e.exercises?.name ?? "",
      goalLabel: e.goal_type === "daily_total" ? `${e.goal_value} reps` : `${e.goal_value}x`,
    }));
    const daySessions = (routinePlanExistedThisDay ? sessions.filter((s) => s.scheduleDays.includes(dow)) : []).map((s) => ({
      name: s.name,
      startTime: s.startTime,
      durationMinutes: s.durationMinutes,
      confirmed: confirmedByDateAndSession.has(`${date}:${s.id}`),
    }));
    const hasScheduledItems = dayMicroExercises.length > 0 || daySessions.length > 0;
    const completed = dayMicroDoneFor(dayMicroExercises, date) && daySessions.every((s) => s.confirmed);
    const status = hasScheduledItems ? weekDayStatus(date, dateStr, completed) : null;
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

      {/* BodyModule (weight/waist, each with its own on-demand "Log"
          affordance) is unconditional here — 2026-08-25/26 batch 2, item 3:
          weight/waist logging must survive with NO active workout plan,
          since it's no longer gated behind a cycle at all. Only the
          cycle-specific content below it (benchmark deltas, "Log cycle
          benchmarks") stays gated on an active plan's cycle existing. */}
      <Panel title="Cycle Progress checks">
        <div className="flex flex-col gap-3">
          <BodyModule
            weightAvg7d={weightAvg7d}
            waist={waist}
            onLogWeight={logWeight.bind(null, dateStr)}
            onLogWaist={logWaist.bind(null, dateStr)}
          />
          {cycle ? (
            <CycleProgressPanel
              cycleNumber={cycle.cycleNumber}
              daysLeft={cycle.daysLeft}
              deltas={deltas}
              benchmarkExercises={benchmarkExercises}
              onLogBenchmark={logCycleBenchmark.bind(null, dateStr)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Activate a workout plan to start tracking cycles.</p>
          )}
        </div>
      </Panel>
    </PageContainer>
  );
}
