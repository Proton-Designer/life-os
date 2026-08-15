import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "@/lib/prayer-times/calculate";
import {
  localDateString,
  localWeekday,
  resolveLocalTime,
  getTimezoneOffsetMinutes,
  dayOfWeekFromDateString,
} from "@/lib/date-utils";
import { urgencyBucket } from "./urgency";
import type { PriorityItem, Domain } from "./types";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
type PrayerName = (typeof PRAYER_NAMES)[number];

const DOMAIN_PRIORITY: Record<Domain, number> = {
  deen: 0,
  business: 1,
  school: 2,
  co_op: 2,
  fitness: 3,
};

export type HomeProfile = {
  location_lat: number | null;
  location_lng: number | null;
  timezone: string;
  prayer_calc_method: string;
  asr_madhab: string;
};

export type HomePrayerRow = { id: string; prayer_name: string; status: string };
export type HomeKillListRow = { id: string; text: string; completed: boolean; position: number };
export type HomeTaskRow = {
  id: string;
  domain: "school" | "co_op";
  title: string;
  due_date: string | null;
  due_time: string | null;
  completed: boolean;
};
export type HomeWorkoutSchedule = { day_of_week: number; workout_name: string; time?: string | null };
export type HomeWorkoutLogRow = { workout_name: string };

export type HomeDataSource = {
  getProfile: (userId: string) => Promise<HomeProfile | null>;
  getPrayers: (userId: string, date: string) => Promise<HomePrayerRow[]>;
  getKillListItems: (userId: string, date: string) => Promise<HomeKillListRow[]>;
  getTasks: (userId: string, date: string) => Promise<HomeTaskRow[]>;
  getWorkoutSchedule: (userId: string, dayOfWeek: number) => Promise<HomeWorkoutSchedule | null>;
  getWorkoutLogs: (userId: string, date: string) => Promise<HomeWorkoutLogRow[]>;
};

// Exported for testing defaultDataSource().getProfile() in isolation — see
// lib/home/__tests__/default-data-source.test.ts. Real callers always use
// the default parameter value in getPriorityItems()/getTodayDateString().
export function defaultDataSource(): HomeDataSource {
  return {
    // Routes through the shared, cache()-per-request getProfile() (see
    // lib/supabase/auth.ts) instead of its own raw query — this used to be
    // a separate, un-deduped profiles read on every Home load, on top of
    // the one layout.tsx/page.tsx already do. Narrows the full row down to
    // just the fields HomeProfile needs (never pass pin_hash or other
    // fields through further than necessary).
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
        .select("id, prayer_name, status")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("id, text, completed, position")
        .eq("user_id", userId)
        .eq("date", date)
        .order("position", { ascending: true });
      return data ?? [];
    },
    async getTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("id, domain, title, due_date, due_time, completed")
        .eq("user_id", userId)
        .eq("due_date", date);
      return (data ?? []) as HomeTaskRow[];
    },
    async getWorkoutSchedule(userId, dayOfWeek) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("day_of_week, workout_name, time")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();
      return data ?? null;
    },
    async getWorkoutLogs(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_logs")
        .select("workout_name")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
  };
}

export async function getPriorityItems(
  userId: string,
  now: Date,
  dataSource: HomeDataSource = defaultDataSource()
): Promise<PriorityItem[]> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);

  const [prayerRows, killListRows, taskRows, workoutSchedule, workoutLogRows] =
    await Promise.all([
      dataSource.getPrayers(userId, dateStr),
      dataSource.getKillListItems(userId, dateStr),
      dataSource.getTasks(userId, dateStr),
      dataSource.getWorkoutSchedule(userId, dayOfWeekFromDateString(dateStr)),
      dataSource.getWorkoutLogs(userId, dateStr),
    ]);

  const items: Omit<PriorityItem, "date">[] = [];

  // Deen: prayers
  let prayerTimes: Record<PrayerName, Date> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    prayerTimes = calculatePrayerTimes({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezoneOffsetMinutes: getTimezoneOffsetMinutes(now, timezone),
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }

  const isFriday = localWeekday(now, timezone) === "Friday";
  for (const prayerName of PRAYER_NAMES) {
    const row = prayerRows.find((p) => p.prayer_name === prayerName);
    const status = row?.status ?? "pending";
    if (status !== "pending") continue; // already logged today — not actionable

    const dueAt = prayerTimes ? prayerTimes[prayerName] : null;
    const title = prayerName === "dhuhr" && isFriday
      ? "Jummah"
      : prayerName.charAt(0).toUpperCase() + prayerName.slice(1);

    items.push({
      id: `prayer-${prayerName}`,
      domain: "deen",
      title,
      dueAt,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_prayer",
      actionRefId: prayerName,
    });
  }

  // Business: kill list, rolled into a single item per spec
  const incompleteKillList = killListRows.filter((k) => !k.completed);
  if (incompleteKillList.length > 0) {
    const next = incompleteKillList[0];
    items.push({
      id: "kill-list",
      domain: "business",
      title:
        incompleteKillList.length === 1
          ? next.text
          : `${incompleteKillList.length} kill-list items remaining`,
      dueAt: null,
      urgencyBucket: "later_today",
      completed: false,
      actionType: "toggle_kill_list",
      actionRefId: next.id,
    });
  }

  // School / Co-op: tasks due today
  for (const task of taskRows) {
    if (task.completed || !task.due_date) continue;
    const dueAt = task.due_time ? resolveLocalTime(task.due_date, task.due_time, timezone) : null;
    items.push({
      id: `task-${task.id}`,
      domain: task.domain,
      title: task.title,
      dueAt,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_task",
      actionRefId: task.id,
    });
  }

  // Fitness: today's scheduled-but-unlogged workout (an ad-hoc log with a
  // matching name also counts as "done", per spec — no separate tracking of
  // scheduled vs. ad-hoc completion).
  if (workoutSchedule && !workoutLogRows.some((w) => w.workout_name === workoutSchedule.workout_name)) {
    const dueAt = workoutSchedule.time
      ? resolveLocalTime(dateStr, workoutSchedule.time, timezone)
      : null;
    items.push({
      id: "workout",
      domain: "fitness",
      title: workoutSchedule.workout_name,
      dueAt,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_workout",
      actionRefId: workoutSchedule.workout_name,
    });
  }

  items.sort((a, b) => {
    if (a.urgencyBucket !== b.urgencyBucket) {
      return a.urgencyBucket === "right_now" ? -1 : 1;
    }
    const aTime = a.dueAt?.getTime() ?? Infinity;
    const bTime = b.dueAt?.getTime() ?? Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return DOMAIN_PRIORITY[a.domain] - DOMAIN_PRIORITY[b.domain];
  });

  return items.map((item) => ({ ...item, date: dateStr }));
}

/**
 * Today's YYYY-MM-DD in the user's profile timezone — for callers (e.g. the
 * domain pulse rings) that need "today" independent of whether any
 * PriorityItem exists to read `.date` off of (the empty/all-clear state).
 */
export async function getTodayDateString(
  userId: string,
  now: Date,
  dataSource: Pick<HomeDataSource, "getProfile"> = defaultDataSource()
): Promise<string> {
  const profile = await dataSource.getProfile(userId);
  return localDateString(now, profile?.timezone ?? "UTC");
}
