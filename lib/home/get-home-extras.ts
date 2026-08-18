import { createClient } from "@/lib/supabase/server";
import { addDaysToDateString, dayOfWeekFromDateString, localDateString } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { computeWeeklyCompletionPct } from "./weekly-completion-trend";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

export type HomeExtras = {
  focusTimeMinutes: number;
  focusSessionCount: number;
  weeklyCompletionPct: number[];
  weeklyCompletionLabels: string[];
};

export async function getHomeExtras(
  userId: string,
  now: Date,
  profile: {
    timezone: string;
    location_lat: number | null;
    location_lng: number | null;
    prayer_calc_method: string;
    asr_madhab: string;
  } | null
): Promise<HomeExtras> {
  const supabase = await createClient();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const sevenDaysAgoStr = addDaysToDateString(todayStr, -6);

  const [
    { data: prayerHistoryRows },
    { data: killListRows },
    { data: taskRows },
    { data: workoutScheduleRows },
    { data: workoutLogRows },
    { data: workSessionRows },
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
    supabase.from("workout_logs").select("date, created_at, workout_name").eq("user_id", userId).gte("date", sevenDaysAgoStr),
    supabase.from("work_sessions").select("started_at, ended_at").eq("user_id", userId).gte("started_at", `${todayStr}T00:00:00Z`),
  ]);

  // --- Focus time today ---
  const focusTimeMinutes = computeFocusTimeMinutes(
    (workSessionRows ?? []).map((s) => ({ startedAt: new Date(s.started_at), endedAt: s.ended_at ? new Date(s.ended_at) : null })),
    now
  );

  // --- 7-day completion trend ---
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
        workoutDone: (workoutLogRows ?? []).some((w) => w.date === date),
      };
    })
  );
  const weeklyCompletionLabels = weekDates.map((d) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
  );

  return {
    focusTimeMinutes,
    focusSessionCount: (workSessionRows ?? []).length,
    weeklyCompletionPct,
    weeklyCompletionLabels,
  };
}
