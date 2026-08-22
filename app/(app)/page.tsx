import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { Inbox } from "lucide-react";
import { getPriorityItems } from "@/lib/home/get-priority-items";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { getHomeExtras } from "@/lib/home/get-home-extras";
import { getDayShape } from "@/lib/home/get-day-shape";
import { computeDayRibbon } from "@/lib/home/day-ribbon";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { localDateString, localWeekday, getTimezoneOffsetMinutes, getWeekStartDate, addDaysToDateString, dayOfWeekFromDateString } from "@/lib/date-utils";
import { isGoalActiveOn } from "@/lib/fitness/rep-goal";
import { NextActions } from "@/components/home/next-actions";
import { FocusModule } from "@/components/home/focus-module";
import { WeeklyFocus } from "@/components/home/weekly-focus";
import { WeeklyGoalStrip } from "@/components/home/weekly-goal-strip";
import { DomainStatusStack } from "@/components/home/domain-status-stack";
import { DayRibbon } from "@/components/home/day-ribbon";
import { HomeFitnessPanel } from "@/components/fitness/home-fitness-panel";
import { HomeOnPlanCard } from "@/components/fitness/home-on-plan-card";
import { loadWorkoutDetails } from "@/lib/fitness/load-workout-details";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { createExercise } from "@/app/(app)/fitness/workouts/actions";
import { quickLogExercise, confirmWorkoutSession } from "@/app/(app)/fitness/actions";
import { saveWeeklyGoal } from "@/app/(app)/actions";

export default async function HomePage() {
  const supabase = await createClient();
  const user = await getAuthedUser();

  // app/(app)/layout.tsx also gates on this, but layout and page data-fetching
  // can run independently (e.g. an unauthenticated request with no session
  // cookie) — guard here too rather than assuming user is always non-null.
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const todayDayOfWeek = dayOfWeekFromDateString(dateStr);

  const [
    items,
    snapshots,
    extras,
    dayShape,
    weeklyGoalsResult,
    activeSession,
    repGoalRows,
    todayRepRows,
    exerciseRows,
    todayScheduleRow,
  ] = await Promise.all([
    getPriorityItems(userId, now),
    getDomainSnapshots(userId, now),
    getHomeExtras(userId, now, profile),
    getDayShape(userId, now),
    supabase
      .from("weekly_goals")
      .select("domain, headline, milestones, quran_page_target")
      .eq("user_id", userId)
      .eq("week_start_date", weekStart)
      .in("domain", ["deen", "business"]),
    getActiveWorkSession(userId),
    supabase
      .from("rep_goals")
      .select("exercise_id, daily_target, active_days, exercises(name)")
      .eq("user_id", userId)
      .eq("archived", false),
    supabase.from("session_sets").select("exercise_id, reps, workout_sessions!inner(date, user_id)").eq("workout_sessions.user_id", userId).eq("workout_sessions.date", dateStr),
    supabase
      .from("exercises")
      .select("id, name, primary_muscles, secondary_muscles")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("name"),
    supabase
      .from("workout_schedule")
      .select("workout_id")
      .eq("user_id", userId)
      .eq("day_of_week", todayDayOfWeek)
      .maybeSingle(),
  ]);

  const todayWorkoutId = todayScheduleRow.data?.workout_id ?? null;
  let todayWorkout = null;
  let todayWorkoutConfirmed = false;
  if (todayWorkoutId) {
    const [detailsById, { data: confirmedRow }] = await Promise.all([
      loadWorkoutDetails(supabase, userId, [todayWorkoutId]),
      supabase
        .from("workout_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("date", dateStr)
        .eq("workout_id", todayWorkoutId)
        .eq("source", "confirmed")
        .maybeSingle(),
    ]);
    todayWorkout = detailsById.get(todayWorkoutId) ?? null;
    todayWorkoutConfirmed = confirmedRow !== null;
  }

  const loggedRepsTodayByExercise = new Map<string, number>();
  for (const row of todayRepRows.data ?? []) {
    if (!row.exercise_id) continue;
    loggedRepsTodayByExercise.set(row.exercise_id, (loggedRepsTodayByExercise.get(row.exercise_id) ?? 0) + row.reps);
  }
  const repGoals = (repGoalRows.data ?? [])
    .filter((g) => isGoalActiveOn(g.active_days, todayDayOfWeek))
    .map((g) => ({
      exerciseId: g.exercise_id,
      exerciseName: g.exercises?.name ?? "",
      dailyTarget: g.daily_target,
      loggedRepsToday: loggedRepsTodayByExercise.get(g.exercise_id) ?? 0,
    }));

  const quickAddExercises = (exerciseRows.data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    primaryMuscles: e.primary_muscles as never,
    secondaryMuscles: e.secondary_muscles as never,
  }));

  const weeklyGoalsRows = weeklyGoalsResult.data ?? [];
  const deenGoalRow = weeklyGoalsRows.find((g) => g.domain === "deen") ?? null;
  const businessGoalRow = weeklyGoalsRows.find((g) => g.domain === "business") ?? null;
  const deenGoal = deenGoalRow
    ? {
        headline: deenGoalRow.headline,
        milestones: (deenGoalRow.milestones as string[] | null) ?? [],
        quranPages: snapshots.deen.quranWeekPages,
        quranTarget: snapshots.deen.quranWeeklyTarget,
      }
    : null;
  const businessGoal = businessGoalRow
    ? {
        headline: businessGoalRow.headline,
        milestones: (businessGoalRow.milestones as string[] | null) ?? [],
      }
    : null;

  // Onboarding (Phase 13) doesn't exist yet — until it does, a fresh account
  // just sees the same empty state as "all clear" with a slightly different
  // message, rather than a 404 redirect to a route that isn't built.
  const isFreshInstall = profile?.onboarding_completed === false && items.length === 0;

  // Weekly planning nudge: unlocks Saturday evening, no hard lockout — just
  // a nudge until it's done, per spec. "This week" here means the upcoming
  // week (starts tomorrow, Sunday), since Saturday evening is when you plan
  // ahead for it.
  const isSaturdayEvening =
    localWeekday(now, timezone) === "Saturday" &&
    (now.getUTCHours() * 60 + now.getUTCMinutes() + getTimezoneOffsetMinutes(now, timezone)) % 1440 >= 18 * 60;
  let showPlanningNudge = false;
  if (isSaturdayEvening) {
    const upcomingWeekStart = addDaysToDateString(getWeekStartDate(dateStr), 7);
    const { data: upcomingGoals } = await supabase
      .from("weekly_goals")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start_date", upcomingWeekStart);
    showPlanningNudge = (upcomingGoals?.length ?? 0) === 0;
  }

  const activeSessionForFocusModule = activeSession
    ? { id: activeSession.id, startedAtIso: activeSession.startedAt }
    : null;

  const ribbonLayout = computeDayRibbon({ prayers: dayShape.prayers, activities: dayShape.activities, now });

  return (
    <PageContainer>
      <PageHeader title="Home" />

      <WeeklyGoalStrip deen={deenGoal} business={businessGoal} />

      <DomainStatusStack snapshots={snapshots} title="Sector progress" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Now">
            <NextActions items={items} isFreshInstall={isFreshInstall} nowIso={now.toISOString()} />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Focus">
            <FocusModule
              focusMinutesToday={extras.focusTimeMinutes}
              sessionCount={extras.focusSessionCount}
              activeSession={activeSessionForFocusModule}
            />
          </Panel>
        </div>
      </div>

      <Panel title="Fitness">
        <div className="flex flex-col gap-3">
          <HomeOnPlanCard
            date={dateStr}
            workout={todayWorkout}
            alreadyConfirmed={todayWorkoutConfirmed}
            onConfirm={confirmWorkoutSession}
          />
          <HomeFitnessPanel
            repGoals={repGoals}
            quickAddExercises={quickAddExercises}
            onQuickLogExercise={quickLogExercise.bind(null, dateStr)}
            onCreateExercise={createExercise}
          />
        </div>
      </Panel>

      <Panel title="The day's shape">
        {ribbonLayout ? (
          <DayRibbon layout={ribbonLayout} todayStr={dateStr} timezone={timezone} />
        ) : (
          <EmptyState
            icon={Inbox}
            message="Set your location in Settings to see today's prayer-anchored timeline"
            action={{ label: "Go to Settings", href: "/settings" }}
          />
        )}
      </Panel>

      <div id="weekly-focus" className="scroll-mt-20">
        <Panel title="This week's focus">
          <WeeklyFocus
            deen={deenGoal}
            business={businessGoal}
            showPlanningNudge={showPlanningNudge}
            onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
            onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
          />
        </Panel>
      </div>
    </PageContainer>
  );
}
