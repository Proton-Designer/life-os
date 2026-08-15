import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import { calculatePrayerTimes, type CalcMethod, type AsrMadhab } from "@/lib/prayer-times/calculate";
import {
  localDateString,
  getTimezoneOffsetMinutes,
  dayOfWeekFromDateString,
  getWeekStartDate,
  addDaysToDateString,
} from "@/lib/date-utils";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { getWeeklySignalNoiseRatio, type SignalNoiseResult } from "@/lib/business/sn-ratio";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";
import { getDomainPulse, type DomainPulse } from "./get-domain-pulse";

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

export type DeenSnapshot = {
  nextPrayer: { name: string; dueAt: string | null } | null;
  prayerStatuses: { name: string; status: string }[];
  quranWeekPages: number;
  quranWeeklyTarget: number | null;
  habitFocusName: string | null;
  habitFocusStreak: number;
  pulse: number;
};

export type BusinessSnapshot = {
  activeSession: { elapsedMs: number; sessionRatioDisplay: string } | null;
  killListDone: number;
  killListTotal: number;
  weeklyRatioDisplay: string;
  pulse: number;
};

export type FitnessSnapshot = {
  scheduledWorkoutName: string | null;
  workoutDone: boolean;
  weeklyConsistency: number;
  workoutsThisWeek: number;
  pulse: number;
};

export type TaskDomainSnapshot = {
  dueTodayCount: number;
  nextDueTitle: string | null;
  completedThisWeek: number;
  pulse: number;
};

export type DomainSnapshots = {
  deen: DeenSnapshot;
  business: BusinessSnapshot;
  fitness: FitnessSnapshot;
  school: TaskDomainSnapshot;
  co_op: TaskDomainSnapshot;
};

export type DomainSnapshotDataSource = {
  getProfile: (userId: string) => Promise<{
    location_lat: number | null;
    location_lng: number | null;
    timezone: string;
    prayer_calc_method: string;
    asr_madhab: string;
  } | null>;
  getPrayers: (userId: string, date: string) => Promise<{ prayer_name: string; status: string }[]>;
  getQuranSessions: (userId: string, weekStart: string) => Promise<{ pages_read: number }[]>;
  getQuranWeeklyTarget: (userId: string, weekStart: string) => Promise<number | null>;
  getWeeklyFocusHabit: (userId: string, weekStart: string) => Promise<{ id: string; name: string } | null>;
  getHabitLogDates: (userId: string, habitId: string, sinceDate: string) => Promise<string[]>;
  getActiveWorkSession: (userId: string) => Promise<{ id: string; startedAt: string } | null>;
  getSessionCheckins: (userId: string, sessionId: string) => Promise<{ tag_type: string | null; answered: boolean }[]>;
  getKillListItems: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  getWeeklySnRatio: (userId: string, weekStart: string) => Promise<SignalNoiseResult>;
  getWorkoutSchedule: (userId: string, dayOfWeek: number) => Promise<{ workout_name: string; time: string | null } | null>;
  /** Whole week, not just today — the daily "done?" check and the weekly total chip both derive from this one fetch. */
  getWorkoutLogsThisWeek: (userId: string, weekStart: string) => Promise<{ workout_name: string; date: string }[]>;
  getFitnessHabits: (userId: string) => Promise<{ id: string; createdAt: string }[]>;
  getFitnessHabitLogs: (userId: string, weekStart: string) => Promise<{ habitId: string; date: string; completed: boolean }[]>;
  /** Whole week, not just today — today's-due-incomplete, next-due-title, and the weekly completed count all derive from this one fetch. */
  getTasksThisWeek: (
    userId: string,
    domain: "school" | "co_op",
    weekStart: string
  ) => Promise<{ id: string; title: string; due_date: string | null; due_time: string | null; completed: boolean }[]>;
  getDomainPulse: (userId: string, date: string) => Promise<DomainPulse>;
};

function defaultDataSource(): DomainSnapshotDataSource {
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
    async getQuranSessions(userId, weekStart) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("quran_sessions")
        .select("pages_read")
        .eq("user_id", userId)
        .gte("date", weekStart);
      return data ?? [];
    },
    async getQuranWeeklyTarget(userId, weekStart) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("weekly_goals")
        .select("quran_page_target")
        .eq("user_id", userId)
        .eq("domain", "deen")
        .eq("week_start_date", weekStart)
        .maybeSingle();
      return data?.quran_page_target ?? null;
    },
    async getWeeklyFocusHabit(userId, weekStart) {
      const supabase = await createClient();
      const { data: focusRow } = await supabase
        .from("deen_weekly_focus")
        .select("habit_id")
        .eq("user_id", userId)
        .eq("week_start_date", weekStart)
        .maybeSingle();
      if (!focusRow) return null;
      const { data: habit } = await supabase
        .from("deen_habits")
        .select("id, name")
        .eq("id", focusRow.habit_id)
        .maybeSingle();
      return habit ?? null;
    },
    async getHabitLogDates(userId, habitId, sinceDate) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("deen_habit_logs")
        .select("date")
        .eq("user_id", userId)
        .eq("habit_id", habitId)
        .eq("completed", true)
        .gte("date", sinceDate);
      return (data ?? []).map((d) => d.date);
    },
    async getActiveWorkSession(userId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("work_sessions")
        .select("id, started_at")
        .eq("user_id", userId)
        .is("ended_at", null)
        .maybeSingle();
      return data ? { id: data.id, startedAt: data.started_at } : null;
    },
    async getSessionCheckins(userId, sessionId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("checkins")
        .select("tag_type, answered")
        .eq("user_id", userId)
        .eq("work_session_id", sessionId);
      return data ?? [];
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("completed")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getWeeklySnRatio(userId, weekStart) {
      return getWeeklySignalNoiseRatio(userId, new Date(`${weekStart}T00:00:00Z`));
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
    async getWorkoutLogsThisWeek(userId, weekStart) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_logs")
        .select("workout_name, date")
        .eq("user_id", userId)
        .gte("date", weekStart);
      return data ?? [];
    },
    async getFitnessHabits(userId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("custom_habits")
        .select("id, created_at")
        .eq("user_id", userId)
        .eq("domain", "fitness")
        .eq("archived", false);
      return (data ?? []).map((h) => ({ id: h.id, createdAt: h.created_at.slice(0, 10) }));
    },
    async getFitnessHabitLogs(userId, weekStart) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("habit_logs")
        .select("habit_id, date, completed")
        .eq("user_id", userId)
        .gte("date", weekStart);
      return (data ?? []).map((l) => ({ habitId: l.habit_id, date: l.date, completed: l.completed }));
    },
    async getTasksThisWeek(userId, domain, weekStart) {
      const supabase = await createClient();
      const weekEnd = addDaysToDateString(weekStart, 6);
      const { data } = await supabase
        .from("tasks")
        .select("id, title, due_date, due_time, completed")
        .eq("user_id", userId)
        .eq("domain", domain)
        .gte("due_date", weekStart)
        .lte("due_date", weekEnd);
      return data ?? [];
    },
    getDomainPulse,
  };
}

function nextDueTaskTitle(tasks: { title: string; due_time: string | null }[]): string | null {
  if (tasks.length === 0) return null;
  const sorted = [...tasks].sort((a, b) => (a.due_time ?? "").localeCompare(b.due_time ?? ""));
  return sorted[0].title;
}

export async function getDomainSnapshots(
  userId: string,
  now: Date,
  dataSource: DomainSnapshotDataSource = defaultDataSource()
): Promise<DomainSnapshots> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const sixtyDaysAgoStr = localDateString(new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), timezone);
  const dayOfWeek = dayOfWeekFromDateString(dateStr);

  const [
    prayerRows,
    quranSessions,
    quranWeeklyTarget,
    weeklyFocusHabit,
    activeSession,
    killListRows,
    weeklySnRatio,
    workoutSchedule,
    workoutLogRowsThisWeek,
    fitnessHabits,
    fitnessHabitLogs,
    schoolTasksThisWeek,
    coOpTasksThisWeek,
    pulse,
  ] = await Promise.all([
    dataSource.getPrayers(userId, dateStr),
    dataSource.getQuranSessions(userId, weekStart),
    dataSource.getQuranWeeklyTarget(userId, weekStart),
    dataSource.getWeeklyFocusHabit(userId, weekStart),
    dataSource.getActiveWorkSession(userId),
    dataSource.getKillListItems(userId, dateStr),
    dataSource.getWeeklySnRatio(userId, weekStart),
    dataSource.getWorkoutSchedule(userId, dayOfWeek),
    dataSource.getWorkoutLogsThisWeek(userId, weekStart),
    dataSource.getFitnessHabits(userId),
    dataSource.getFitnessHabitLogs(userId, weekStart),
    dataSource.getTasksThisWeek(userId, "school", weekStart),
    dataSource.getTasksThisWeek(userId, "co_op", weekStart),
    dataSource.getDomainPulse(userId, dateStr),
  ]);

  // Deen
  let prayerTimes: Record<(typeof PRAYER_NAMES)[number], Date> | null = null;
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
  const nextPendingPrayer = PRAYER_NAMES.find((name) => {
    const row = prayerRows.find((p) => p.prayer_name === name);
    return (row?.status ?? "pending") === "pending";
  });
  const habitFocusStreak = weeklyFocusHabit
    ? computeHabitStreak(await dataSource.getHabitLogDates(userId, weeklyFocusHabit.id, sixtyDaysAgoStr), dateStr)
    : 0;

  const deen: DeenSnapshot = {
    nextPrayer: nextPendingPrayer
      ? { name: nextPendingPrayer, dueAt: prayerTimes ? prayerTimes[nextPendingPrayer].toISOString() : null }
      : null,
    prayerStatuses: PRAYER_NAMES.map((name) => ({
      name,
      status: prayerRows.find((p) => p.prayer_name === name)?.status ?? "pending",
    })),
    quranWeekPages: quranSessions.reduce((sum, s) => sum + s.pages_read, 0),
    quranWeeklyTarget,
    habitFocusName: weeklyFocusHabit?.name ?? null,
    habitFocusStreak,
    pulse: pulse.deen,
  };

  // Business
  let activeSessionSummary: BusinessSnapshot["activeSession"] = null;
  if (activeSession) {
    const sessionCheckins = await dataSource.getSessionCheckins(userId, activeSession.id);
    const answered = sessionCheckins.filter((c) => c.answered);
    const signal = answered.filter((c) => c.tag_type === "kill_list").length;
    const noise = answered.filter((c) => c.tag_type === "noise").length;
    activeSessionSummary = {
      elapsedMs: now.getTime() - new Date(activeSession.startedAt).getTime(),
      sessionRatioDisplay: computeRatioDisplay(signal, noise, answered.length > 0),
    };
  }
  const business: BusinessSnapshot = {
    activeSession: activeSessionSummary,
    killListDone: killListRows.filter((k) => k.completed).length,
    killListTotal: killListRows.length,
    weeklyRatioDisplay: weeklySnRatio.display,
    pulse: pulse.business,
  };

  // Fitness
  const todaysWorkoutLogs = workoutLogRowsThisWeek.filter((w) => w.date === dateStr);
  const workoutDone = workoutSchedule
    ? todaysWorkoutLogs.some((w) => w.workout_name === workoutSchedule.workout_name)
    : false;
  const fitness: FitnessSnapshot = {
    scheduledWorkoutName: workoutSchedule?.workout_name ?? null,
    workoutDone,
    weeklyConsistency: calculateWeeklyConsistency(fitnessHabits, fitnessHabitLogs, weekStart, dateStr),
    workoutsThisWeek: workoutLogRowsThisWeek.length,
    pulse: pulse.fitness,
  };

  // School / Co-op
  const dueTodaySchool = schoolTasksThisWeek.filter((t) => !t.completed && t.due_date === dateStr);
  const dueTodayCoOp = coOpTasksThisWeek.filter((t) => !t.completed && t.due_date === dateStr);
  const school: TaskDomainSnapshot = {
    dueTodayCount: dueTodaySchool.length,
    nextDueTitle: nextDueTaskTitle(dueTodaySchool),
    completedThisWeek: schoolTasksThisWeek.filter((t) => t.completed).length,
    pulse: pulse.school,
  };
  const co_op: TaskDomainSnapshot = {
    dueTodayCount: dueTodayCoOp.length,
    nextDueTitle: nextDueTaskTitle(dueTodayCoOp),
    completedThisWeek: coOpTasksThisWeek.filter((t) => t.completed).length,
    // No separate co-op fraction exists — get-domain-pulse.ts folds co-op
    // tasks into the school fraction, so the peek card reuses that same value.
    pulse: pulse.school,
  };

  return { deen, business, fitness, school, co_op };
}
