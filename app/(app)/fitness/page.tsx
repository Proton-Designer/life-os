import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";
import { HabitList, type HabitData } from "@/components/fitness/habit-list";
import { WorkoutWeekGrid } from "@/components/fitness/workout-week-grid";
import { AdhocWorkoutForm } from "@/components/fitness/adhoc-workout-form";
import { IconChip } from "@/components/ui/icon-chip";
import { StatCard } from "@/components/ui/stat-card";
import { DOMAIN_ICON } from "@/lib/domain-icons";

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
        .gte("date", weekStart),
      supabase.from("workout_schedule").select("day_of_week, workout_name").eq("user_id", userId),
      supabase
        .from("workout_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("date", weekStart),
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

  const schedule: (string | null)[] = Array.from({ length: 7 }, (_, dayOfWeek) => {
    return scheduleRows?.find((s) => s.day_of_week === dayOfWeek)?.workout_name ?? null;
  });
  const scheduledDaysThisWeek = schedule.filter(Boolean).length;
  const workoutsLoggedThisWeek = workoutLogRows?.length ?? 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <section className="flex flex-col gap-4">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold">
          <IconChip icon={DOMAIN_ICON.fitness} accent="fitness" size="sm" />
          Habits
        </h1>
        <StatCard
          icon={DOMAIN_ICON.fitness}
          accent="fitness"
          label="Weekly consistency"
          value={`${Math.round(consistency * 100)}%`}
        />
        <HabitList date={dateStr} habits={habits} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-muted-foreground">
          <IconChip icon={DOMAIN_ICON.fitness} accent="fitness" size="sm" />
          Workout schedule
        </h2>
        <StatCard
          icon={DOMAIN_ICON.fitness}
          accent="fitness"
          label="Workouts this week"
          value={`${workoutsLoggedThisWeek}/${scheduledDaysThisWeek || 5}`}
        />
        <WorkoutWeekGrid schedule={schedule} />
      </section>

      <AdhocWorkoutForm date={dateStr} />
    </div>
  );
}
