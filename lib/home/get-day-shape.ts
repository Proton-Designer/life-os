import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import { localDateString, dayOfWeekFromDateString, resolveLocalTime, addDaysToDateString } from "@/lib/date-utils";
import { computePrayerWindows, PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import { effectivePrayerStatus, type StoredPrayerStatus } from "@/lib/deen/prayer-status";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import type { RibbonPrayerInput, RibbonActivityInput } from "./day-ribbon";

const PRAYER_LABEL: Record<PrayerName, string> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

// A workout's real duration isn't tracked anywhere in this schema — a
// nominal 45-minute band makes it visible on the timeline without claiming
// false precision. Same reasoning for a timed task's 15-minute band: it's a
// due instant, not a tracked duration.
const NOMINAL_WORKOUT_MS = 45 * 60_000;
const NOMINAL_TASK_MS = 15 * 60_000;

export type DayShapeProfile = {
  location_lat: number | null;
  location_lng: number | null;
  timezone: string;
  prayer_calc_method: string;
  asr_madhab: string;
};
export type DayShapePrayerRow = { prayer_name: string; status: string };
export type DayShapeWorkoutSchedule = { workout_name: string; time: string | null };
export type DayShapeTaskRow = { title: string; domain: "school" | "co_op"; due_time: string };
export type DayShapeSessionRow = { started_at: string; ended_at: string | null };

export type DayShapeDataSource = {
  getProfile: (userId: string) => Promise<DayShapeProfile | null>;
  getPrayers: (userId: string, date: string) => Promise<DayShapePrayerRow[]>;
  getWorkoutSchedule: (userId: string, dayOfWeek: number) => Promise<DayShapeWorkoutSchedule | null>;
  getTimedTasks: (userId: string, date: string) => Promise<DayShapeTaskRow[]>;
  getFocusSessions: (userId: string, date: string, timezone: string) => Promise<DayShapeSessionRow[]>;
};

export function defaultDataSource(): DayShapeDataSource {
  return {
    async getProfile(_userId) {
      const profile = await getSharedProfile();
      if (!profile) return null;
      return {
        location_lat: profile.location_lat,
        location_lng: profile.location_lng,
        timezone: profile.timezone,
        prayer_calc_method: profile.prayer_calc_method,
        asr_madhab: profile.asr_madhab,
      };
    },
    async getPrayers(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("prayer_name, status")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getWorkoutSchedule(userId, dayOfWeek) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("workout_name, time")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();
      return data ?? null;
    },
    async getTimedTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("title, domain, due_time")
        .eq("user_id", userId)
        .eq("due_date", date)
        .not("due_time", "is", null);
      return (data ?? []) as DayShapeTaskRow[];
    },
    async getFocusSessions(userId, date, timezone) {
      const supabase = await createClient();
      // Bounds must be the LOCAL day converted to instants, not a UTC-day
      // string range — `date` is already local, and a naive `${date}T00:00Z`
      // range is off by the timezone offset in both directions (e.g. a
      // Chicago evening session lands in the UTC date's early hours the
      // *next* calendar day, and gets dropped from today / shown on
      // tomorrow instead). See PROJECT_STATUS.md 2026-08-18 for the bug
      // this fixes and lib/home/get-home-extras.ts for the sibling case.
      const dayStart = resolveLocalTime(date, "00:00", timezone).toISOString();
      const dayEnd = resolveLocalTime(addDaysToDateString(date, 1), "00:00", timezone).toISOString();
      const { data } = await supabase
        .from("work_sessions")
        .select("started_at, ended_at")
        .eq("user_id", userId)
        .gte("started_at", dayStart)
        .lt("started_at", dayEnd);
      return data ?? [];
    },
  };
}

/**
 * Today's prayers as windows+derived-status, plus the day's other activity
 * blocks (scheduled workout, timed School/Work tasks, focus/Lock-In
 * sessions) — the raw material for DayRibbon. Genuinely new data assembly,
 * not a re-render of the old point-marker version: this is the one place
 * "here's my whole day's shape" exists cross-domain in the app.
 */
export async function getDayShape(
  userId: string,
  now: Date,
  dataSource: DayShapeDataSource = defaultDataSource()
): Promise<{ prayers: RibbonPrayerInput[]; activities: RibbonActivityInput[] }> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);

  const [prayerRows, workoutSchedule, timedTasks, focusSessions] = await Promise.all([
    dataSource.getPrayers(userId, dateStr),
    dataSource.getWorkoutSchedule(userId, dayOfWeekFromDateString(dateStr)),
    dataSource.getTimedTasks(userId, dateStr),
    dataSource.getFocusSessions(userId, dateStr, timezone),
  ]);

  const hasLocation = profile?.location_lat != null && profile?.location_lng != null;
  const windows = hasLocation
    ? computePrayerWindows({
        date: now,
        lat: profile!.location_lat!,
        lng: profile!.location_lng!,
        timezone,
        calcMethod: (profile!.prayer_calc_method as CalcMethod) || "MWL",
        asrMadhab: (profile!.asr_madhab as AsrMadhab) || "standard",
      })
    : null;

  const prayers: RibbonPrayerInput[] = PRAYER_NAMES.map((name) => {
    const row = prayerRows.find((r) => r.prayer_name === name);
    const stored = (row?.status as StoredPrayerStatus | undefined) ?? null;
    const window = windows ? windows[name] : null;
    return {
      name,
      label: PRAYER_LABEL[name],
      window,
      status: effectivePrayerStatus(stored, window, now),
    };
  });

  const activities: RibbonActivityInput[] = [];

  if (workoutSchedule?.time) {
    const start = resolveLocalTime(dateStr, workoutSchedule.time, timezone);
    activities.push({
      label: workoutSchedule.workout_name,
      colorVar: "--series-fitness",
      start,
      end: new Date(start.getTime() + NOMINAL_WORKOUT_MS),
    });
  }

  for (const task of timedTasks) {
    const start = resolveLocalTime(dateStr, task.due_time, timezone);
    activities.push({
      label: task.title,
      colorVar: task.domain === "school" ? "--series-school" : "--series-coop",
      start,
      end: new Date(start.getTime() + NOMINAL_TASK_MS),
    });
  }

  for (const session of focusSessions) {
    activities.push({
      label: "Focus session",
      colorVar: "--series-business",
      start: new Date(session.started_at),
      end: session.ended_at ? new Date(session.ended_at) : null,
    });
  }

  return { prayers, activities };
}
