import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";
import { HabitList, type HabitData } from "@/components/fitness/habit-list";
import { WorkoutWeekGrid } from "@/components/fitness/workout-week-grid";
import { AdhocWorkoutForm } from "@/components/fitness/adhoc-workout-form";

export default async function FitnessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
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
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Habits</h1>
          <span className="text-sm text-muted-foreground">
            {Math.round(consistency * 100)}% this week
          </span>
        </div>
        <HabitList date={dateStr} habits={habits} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Workout schedule</h2>
          <span className="text-xs text-muted-foreground">
            {workoutsLoggedThisWeek}/{scheduledDaysThisWeek || 5} this week
          </span>
        </div>
        <WorkoutWeekGrid schedule={schedule} />
      </section>

      <AdhocWorkoutForm date={dateStr} />
    </div>
  );
}
