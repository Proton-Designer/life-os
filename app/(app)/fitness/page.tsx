import { redirect } from "next/navigation";
import { Flame, CalendarCheck, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";
import { buildHabitConsistencyRows } from "@/lib/fitness/habit-consistency";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { accentForActivityCount } from "@/lib/kpi-value-accent";
import { HabitList, type HabitData } from "@/components/fitness/habit-list";
import { WorkoutWeekGrid } from "@/components/fitness/workout-week-grid";
import { AdhocWorkoutForm } from "@/components/fitness/adhoc-workout-form";
import { TodayWorkoutCard } from "@/components/fitness/today-workout-card";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ConsistencyGrid } from "@/components/charts/consistency-grid";

const HABIT_STATUS_STYLE = {
  done: { colorVar: "--accent-business", treatment: "solid" as const, label: "Done" },
  missed: { colorVar: "--destructive", treatment: "hollow" as const, label: "Missed" },
};

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
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart, i));
  const thirtyDaysAgoStr = addDaysToDateString(dateStr, -29);
  const sixtyDaysAgoStr = addDaysToDateString(dateStr, -59);
  const monthPrefix = dateStr.slice(0, 7);

  const [{ data: habitRows }, { data: logRows }, { data: scheduleRows }, { data: workoutLogRows }] =
    await Promise.all([
      supabase
        .from("custom_habits")
        .select("id, name, created_at")
        .eq("user_id", userId)
        .eq("domain", "fitness")
        .eq("archived", false)
        .order("created_at", { ascending: true }),
      supabase
        .from("habit_logs")
        .select("habit_id, date, completed")
        .eq("user_id", userId)
        .gte("date", thirtyDaysAgoStr),
      supabase.from("workout_schedule").select("day_of_week, workout_name").eq("user_id", userId),
      // One 60-day range serves today's log check, this week's count, this
      // month's count, and the streak — sliced in memory rather than four
      // separate queries.
      supabase.from("workout_logs").select("date").eq("user_id", userId).gte("date", sixtyDaysAgoStr),
    ]);

  const habits: HabitData[] = (habitRows ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    completedToday: logRows?.some((l) => l.habit_id === h.id && l.date === dateStr && l.completed) ?? false,
  }));

  const consistency = calculateWeeklyConsistency(
    (habitRows ?? []).map((h) => ({ id: h.id, createdAt: h.created_at.slice(0, 10) })),
    (logRows ?? []).map((l) => ({ habitId: l.habit_id, date: l.date, completed: l.completed })),
    weekStart,
    dateStr
  );

  const thirtyDays = Array.from({ length: 30 }, (_, i) => addDaysToDateString(thirtyDaysAgoStr, i));
  const consistencyRows = buildHabitConsistencyRows(
    (habitRows ?? []).map((h) => ({ id: h.id, name: h.name, createdAt: h.created_at.slice(0, 10) })),
    (logRows ?? []).map((l) => ({ habitId: l.habit_id, date: l.date, completed: l.completed })),
    thirtyDays,
    dateStr
  );

  const schedule: (string | null)[] = Array.from({ length: 7 }, (_, dayOfWeek) => {
    return scheduleRows?.find((s) => s.day_of_week === dayOfWeek)?.workout_name ?? null;
  });
  const scheduledDaysThisWeek = schedule.filter(Boolean).length;

  const workoutDates = (workoutLogRows ?? []).map((w) => w.date);
  const workoutsLoggedThisWeek = workoutDates.filter((d) => weekDates.includes(d)).length;
  const workoutsThisMonth = workoutDates.filter((d) => d.startsWith(monthPrefix)).length;
  const workoutStreak = computeHabitStreak(workoutDates, dateStr);
  const loggedToday = workoutDates.includes(dateStr);
  const todayDayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const todayScheduledName = schedule[todayDayOfWeek] ?? null;

  return (
    <PageContainer>
      <PageHeader title="Fitness" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <TodayWorkoutCard scheduledName={todayScheduledName} logged={loggedToday} date={dateStr} accent="fitness" />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent={accentForActivityCount(workoutStreak)}
            label="Current streak"
            value={`${workoutStreak}`}
            caption={workoutStreak === 0 ? "Log a workout to start one" : "Keep it going"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={CalendarCheck}
            accent={accentForActivityCount(workoutsThisMonth)}
            label="Workouts this month"
            value={`${workoutsThisMonth}`}
            caption={workoutsThisMonth === 0 ? "Nothing logged yet this month" : `${workoutsThisMonth} logged so far`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel
            title="Habits"
            heroValue={`${Math.round(consistency * 100)}%`}
            caption="weekly consistency"
          >
            <div className="flex flex-col gap-4">
              {habits.length > 0 ? (
                <ConsistencyGrid rows={consistencyRows} statusStyle={HABIT_STATUS_STYLE} />
              ) : (
                <EmptyState
                  icon={Repeat}
                  message="No habits yet"
                  action={{ label: "Add a habit", href: "#fitness-add-habit" }}
                />
              )}
              <HabitList date={dateStr} habits={habits} />
            </div>
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel
            title="Workout schedule"
            heroValue={`${workoutsLoggedThisWeek}/${scheduledDaysThisWeek || 5}`}
            caption="workouts logged this week"
          >
            <WorkoutWeekGrid schedule={schedule} />
          </Panel>
        </div>
      </div>

      <Panel title="Log a workout">
        <AdhocWorkoutForm date={dateStr} />
      </Panel>
    </PageContainer>
  );
}
