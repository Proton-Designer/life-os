import { createClient } from "@/lib/supabase/server";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "@/lib/prayer-times/calculate";
import {
  localDateString,
  addDaysToDateString,
  dayOfWeekFromDateString,
  getTimezoneOffsetMinutes,
} from "@/lib/date-utils";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computeDayRibbon, type DayRibbonLayout } from "./day-ribbon";
import { computeTodayCompletion, computeFocusTimeMinutes, allPrayersDoneDates } from "./home-kpis";
import { computeWeeklyCompletionPct } from "./weekly-completion-trend";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const PRAYER_LABEL: Record<string, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

// Checkin tag_type -> chart series token, same mapping as Insights' Focus
// Map (lib/insights/focus-map.ts's SEGMENT_MAP) but pointed at the newer
// --series-* chart tokens instead of brand accents.
const TAG_SERIES: Record<string, string> = {
  kill_list: "--series-business",
  workout: "--series-fitness",
  deen: "--series-deen",
  school: "--series-school",
  co_op: "--series-coop",
  noise: "--series-noise",
  other_work: "--series-other",
};

export type HomeExtras = {
  dayRibbon: DayRibbonLayout | null;
  todayCompletion: { done: number; total: number };
  focusTimeMinutes: number;
  focusSessionCount: number;
  prayerStreak: number;
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
  const sixtyDaysAgoStr = addDaysToDateString(todayStr, -59);
  const sevenDaysAgoStr = addDaysToDateString(todayStr, -6);

  const [
    { data: prayerHistoryRows },
    { data: killListRows },
    { data: taskRows },
    { data: workoutScheduleRows },
    { data: workoutLogRows },
    { data: workSessionRows },
    { data: checkinRows },
  ] = await Promise.all([
    supabase.from("prayers").select("date, prayer_name, status").eq("user_id", userId).gte("date", sixtyDaysAgoStr),
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
    supabase
      .from("checkins")
      .select("checkin_time, tag_type, tag_label, answered")
      .eq("user_id", userId)
      .eq("answered", true)
      .gte("checkin_time", `${todayStr}T00:00:00Z`),
  ]);

  // --- Day Ribbon ---
  let dayRibbon: DayRibbonLayout | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    const prayerTimes = calculatePrayerTimes({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(now, timezone),
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
    const todayPrayerRows = (prayerHistoryRows ?? []).filter((p) => p.date === todayStr);
    const prayers = PRAYER_NAMES.map((name) => ({
      name,
      label: PRAYER_LABEL[name],
      time: prayerTimes[name],
      status: todayPrayerRows.find((p) => p.prayer_name === name)?.status ?? "pending",
    }));

    const activities = [
      ...(checkinRows ?? []).map((c) => ({
        label: c.tag_label ?? c.tag_type ?? "Check-in",
        colorVar: TAG_SERIES[c.tag_type ?? ""] ?? "--series-other",
        start: new Date(c.checkin_time),
        end: new Date(new Date(c.checkin_time).getTime() + 15 * 60_000),
      })),
      ...(workSessionRows ?? []).map((s) => ({
        label: "Lock-In",
        colorVar: "--series-business",
        start: new Date(s.started_at),
        end: s.ended_at ? new Date(s.ended_at) : null,
      })),
      ...(workoutLogRows ?? [])
        .filter((w) => w.date === todayStr)
        .map((w) => ({
          label: w.workout_name,
          colorVar: "--series-fitness",
          start: new Date(w.created_at),
          end: new Date(new Date(w.created_at).getTime() + 30 * 60_000),
        })),
    ];

    dayRibbon = computeDayRibbon({ prayers, activities, now });
  }

  // --- Today's completion ---
  const todayPrayerStatuses = PRAYER_NAMES.map(
    (name) => (prayerHistoryRows ?? []).find((p) => p.date === todayStr && p.prayer_name === name)?.status ?? "pending"
  );
  const todayKillList = (killListRows ?? []).filter((k) => k.date === todayStr);
  const todayTasks = (taskRows ?? []).filter((t) => t.due_date === todayStr);
  const todayDayOfWeek = dayOfWeekFromDateString(todayStr);
  const scheduledWorkoutToday = (workoutScheduleRows ?? []).find((s) => s.day_of_week === todayDayOfWeek);
  const workoutDoneToday = (workoutLogRows ?? []).some((w) => w.date === todayStr);
  const todayCompletion = computeTodayCompletion({
    prayerStatuses: todayPrayerStatuses,
    killList: todayKillList,
    tasks: todayTasks,
    hasScheduledWorkout: Boolean(scheduledWorkoutToday),
    workoutDone: workoutDoneToday,
  });

  // --- Focus time today ---
  const focusTimeMinutes = computeFocusTimeMinutes(
    (workSessionRows ?? []).map((s) => ({ startedAt: new Date(s.started_at), endedAt: s.ended_at ? new Date(s.ended_at) : null })),
    now
  );

  // --- Prayer streak ---
  const prayersByDate: Record<string, string[]> = {};
  for (const row of prayerHistoryRows ?? []) {
    (prayersByDate[row.date] ??= []).push(row.status);
  }
  const prayerStreak = computeHabitStreak(allPrayersDoneDates(prayersByDate), todayStr);

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
    dayRibbon,
    todayCompletion,
    focusTimeMinutes,
    focusSessionCount: (workSessionRows ?? []).length,
    prayerStreak,
    weeklyCompletionPct,
    weeklyCompletionLabels,
  };
}
