import { createClient } from "@/lib/supabase/server";
import { addDaysToDateString, dayOfWeekFromDateString, localDateString } from "@/lib/date-utils";
import { computeWeeklyCompletionPct } from "./weekly-completion-trend";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

export type WeeklyCompletion = {
  weeklyCompletionPct: number[];
  weeklyCompletionLabels: string[];
};

// Split out of get-home-extras.ts when the "This week" completion chart
// moved from Home to Insights (2026-08-17 day-shape spec) — Home no longer
// needs this, Insights does, and the two pages' data needs no longer
// overlap enough to share one function.
export async function getWeeklyCompletion(
  userId: string,
  now: Date,
  profile: { timezone: string } | null
): Promise<WeeklyCompletion> {
  const supabase = await createClient();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const sevenDaysAgoStr = addDaysToDateString(todayStr, -6);

  const [
    { data: prayerHistoryRows },
    { data: killListRows },
    { data: taskRows },
    { data: workoutScheduleRows },
    { data: workoutSessionRows },
  ] = await Promise.all([
    supabase.from("prayers").select("date, prayer_name, status").eq("user_id", userId).gte("date", sevenDaysAgoStr),
    supabase.from("kill_list_items").select("date, completed").eq("user_id", userId).gte("date", sevenDaysAgoStr),
    supabase
      .from("tasks")
      .select("due_date, completed")
      .eq("user_id", userId)
      .gte("due_date", sevenDaysAgoStr)
      .lte("due_date", todayStr),
    supabase.from("workout_schedule").select("day_of_week, workout_name").eq("user_id", userId),
    // Repointed off the dropped workout_logs (Fitness redesign, 2026-08-20)
    // — this is a coarse "did anything happen that day" check for the
    // completion chart, not a workout-specific match, so any session row
    // (confirmed/adhoc/quick) counts the same as the old table's rows did.
    supabase.from("workout_sessions").select("date").eq("user_id", userId).gte("date", sevenDaysAgoStr),
  ]);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(sevenDaysAgoStr, i));
  const weeklyCompletionPct = computeWeeklyCompletionPct(
    weekDates.map((date) => {
      const dow = dayOfWeekFromDateString(date);
      const scheduled = (workoutScheduleRows ?? []).find((s) => s.day_of_week === dow);
      return {
        prayerStatuses: PRAYER_NAMES.map(
          (name) => (prayerHistoryRows ?? []).find((p) => p.date === date && p.prayer_name === name)?.status ?? "pending"
        ),
        killList: (killListRows ?? []).filter((k) => k.date === date),
        tasks: (taskRows ?? []).filter((t) => t.due_date === date),
        hasScheduledWorkout: Boolean(scheduled),
        workoutDone: (workoutSessionRows ?? []).some((w) => w.date === date),
      };
    })
  );
  const weeklyCompletionLabels = weekDates.map((d) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
  );

  return { weeklyCompletionPct, weeklyCompletionLabels };
}
