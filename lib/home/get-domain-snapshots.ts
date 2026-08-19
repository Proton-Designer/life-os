import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { computePrayerWindows, PRAYER_NAMES } from "@/lib/prayer-times/windows";
import { effectivePrayerStatus, resolvePrayerStatuses, type StoredPrayerStatus } from "@/lib/deen/prayer-status";
import { buildQadaBacklog } from "@/lib/deen/qada-backlog";
import {
  localDateString,
  dayOfWeekFromDateString,
  getWeekStartDate,
  addDaysToDateString,
  resolveLocalTime,
} from "@/lib/date-utils";
import { computeHabitStreak } from "@/lib/deen/habit-streak";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { getWeeklySignalNoiseRatio, type SignalNoiseResult } from "@/lib/business/sn-ratio";
import { calculateWeeklyConsistency } from "@/lib/fitness/consistency";
import { getDomainPulse, type DomainPulse } from "./get-domain-pulse";

export type DeenSnapshot = {
  nextPrayer: { name: string; dueAt: string | null } | null;
  prayerStatuses: { name: string; status: string }[];
  quranWeekPages: number;
  quranWeeklyTarget: number | null;
  habitFocusName: string | null;
  habitFocusStreak: number;
  pulse: number | null;
  /** buildQadaBacklog(resolved).derivedCount — outstanding, derived-missed
   * prayers since the account's own floor. Not the legacy+derived total
   * qada-progress.ts shows on Deen's own page; this is specifically the
   * doorway signal for Home's Sector progress row. */
  qadaBacklogCount: number;
};

export type BusinessSnapshot = {
  activeSession: { elapsedMs: number; sessionRatioDisplay: string } | null;
  killListDone: number;
  killListTotal: number;
  weeklyRatioDisplay: string;
  pulse: number | null;
};

export type FitnessSnapshot = {
  scheduledWorkoutName: string | null;
  workoutDone: boolean;
  weeklyConsistency: number;
  workoutsThisWeek: number;
  pulse: number | null;
};

export type TaskDomainSnapshot = {
  dueTodayCount: number;
  nextDueTitle: string | null;
  completedThisWeek: number;
  pulse: number | null;
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
    created_at: string;
  } | null>;
  getPrayers: (userId: string, date: string) => Promise<{ prayer_name: string; status: string }[]>;
  /** Raw prayer rows from `sinceDate` on — used only for the last two days
   * (T-1, T), where a real window resolve is still needed. */
  getPrayerHistory: (userId: string, sinceDate: string) => Promise<{ date: string; prayer_name: string; status: string }[]>;
  /** Head-only count (no rows transferred) of prayers logged on_time/qada
   * within [fromDate, toDate] — every other slot in that closed range is
   * missed by elimination, so this is all the qada backlog derivation needs
   * for dates provably past their window (T-2 and earlier). */
  getPrayerHandledCount: (userId: string, fromDate: string, toDate: string) => Promise<number>;
  getQuranSessions: (userId: string, weekStart: string) => Promise<{ pages_read: number }[]>;
  getQuranWeeklyTarget: (userId: string, weekStart: string) => Promise<number | null>;
  getWeeklyFocusHabit: (userId: string, weekStart: string) => Promise<{ id: string; name: string } | null>;
  getHabitLogDates: (userId: string, habitId: string, sinceDate: string) => Promise<string[]>;
  getActiveWorkSession: (userId: string) => Promise<{ id: string; startedAt: string } | null>;
  getSessionCheckins: (userId: string, sessionId: string) => Promise<{ tag_type: string | null; answered: boolean }[]>;
  getKillListItems: (userId: string, date: string) => Promise<{ completed: boolean }[]>;
  getWeeklySnRatio: (userId: string, weekStart: string, timezone: string) => Promise<SignalNoiseResult>;
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

// Exported for testing in isolation — see
// lib/home/__tests__/get-domain-snapshots-default-source.test.ts. Real
// callers always use the default parameter value in getDomainSnapshots().
export function defaultDataSource(): DomainSnapshotDataSource {
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
        created_at: profile.created_at,
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
    async getPrayerHistory(userId, sinceDate) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("date, prayer_name, status")
        .eq("user_id", userId)
        .gte("date", sinceDate);
      return data ?? [];
    },
    async getPrayerHandledCount(userId, fromDate, toDate) {
      const supabase = await createClient();
      const { count } = await supabase
        .from("prayers")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", fromDate)
        .lte("date", toDate)
        .in("status", ["on_time", "qada"]);
      return count ?? 0;
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
    async getWeeklySnRatio(userId, weekStart, timezone) {
      // resolveLocalTime, not `${weekStart}T00:00:00Z` — the latter applies
      // UTC midnight to a local date string, which in Chicago makes weeks
      // run Sat 7pm -> Sat 7pm and puts Saturday-evening activity (exactly
      // when weekly planning happens) in the wrong week. Same class of bug
      // fixed in get-day-shape.ts on 2026-08-18.
      return getWeeklySignalNoiseRatio(userId, resolveLocalTime(weekStart, "00:00", timezone));
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

  // Qada backlog doorway signal, set up before the batch so the two new
  // fetches below can run inside it rather than after. Same 60-dates-ending-
  // today floor convention as app/(app)/deen/page.tsx's own qada backlog —
  // kept as its own variable rather than reusing sixtyDaysAgoStr above (a
  // slightly different now-minus-60*24h computation, used for the unrelated
  // habit-streak lookback) so the derived count here matches Deen's page.
  //
  // Every date <= T-2 has all five windows provably closed (Isha's outer
  // bound is next-day Fajr), so instead of a 60-day row fetch + per-day
  // resolve, that range only needs a head-only count: every slot is either
  // handled (on_time/qada) or missed, so missed = totalSlots - handled.
  // Only T-1 and T can still have an open window relative to `now`, and
  // keep the real resolvePrayerStatuses resolve against a 2-day row fetch.
  const accountCreatedDateStr = localDateString(
    profile?.created_at ? new Date(profile.created_at) : now,
    timezone
  );
  const qadaFloorDateStr = addDaysToDateString(dateStr, -59);
  const twoDaysAgoStr = addDaysToDateString(dateStr, -2);
  const oneDayAgoStr = addDaysToDateString(dateStr, -1);
  const oldQadaRangeStart = accountCreatedDateStr > qadaFloorDateStr ? accountCreatedDateStr : qadaFloorDateStr;

  const [
    prayerRows,
    recentPrayerRows,
    oldPrayerHandledCount,
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
    dataSource.getPrayerHistory(userId, oneDayAgoStr),
    dataSource.getPrayerHandledCount(userId, oldQadaRangeStart, twoDaysAgoStr),
    dataSource.getQuranSessions(userId, weekStart),
    dataSource.getQuranWeeklyTarget(userId, weekStart),
    dataSource.getWeeklyFocusHabit(userId, weekStart),
    dataSource.getActiveWorkSession(userId),
    dataSource.getKillListItems(userId, dateStr),
    dataSource.getWeeklySnRatio(userId, weekStart, timezone),
    dataSource.getWorkoutSchedule(userId, dayOfWeek),
    dataSource.getWorkoutLogsThisWeek(userId, weekStart),
    dataSource.getFitnessHabits(userId),
    dataSource.getFitnessHabitLogs(userId, weekStart),
    dataSource.getTasksThisWeek(userId, "school", weekStart),
    dataSource.getTasksThisWeek(userId, "co_op", weekStart),
    dataSource.getDomainPulse(userId, dateStr),
  ]);

  // Deen — windowed, not instants. "Next prayer" is the first one that's
  // neither completed nor missed (still pending or upcoming), not just the
  // first unlogged one in Fajr..Isha order, so a closed-and-unlogged Fajr
  // doesn't get stuck showing as "next" all day.
  let windows: Record<(typeof PRAYER_NAMES)[number], { start: Date; end: Date } | null> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    windows = computePrayerWindows({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezone,
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }
  const effectiveStatusFor = (name: (typeof PRAYER_NAMES)[number]) => {
    const row = prayerRows.find((p) => p.prayer_name === name);
    const stored = (row?.status as StoredPrayerStatus | undefined) ?? null;
    return effectivePrayerStatus(stored, windows ? windows[name] : null, now);
  };
  const nextPendingPrayer = PRAYER_NAMES.find((name) => {
    const effective = effectiveStatusFor(name);
    return effective === "pending" || effective === "upcoming";
  });
  const habitFocusStreak = weeklyFocusHabit
    ? computeHabitStreak(await dataSource.getHabitLogDates(userId, weeklyFocusHabit.id, sixtyDaysAgoStr), dateStr)
    : 0;

  // Old range (<= T-2): closed by elimination, no row detail needed.
  // `profiles.status` defaults to 'pending' (never actually logged), so
  // subtracting only the handled statuses (on_time/qada) correctly counts
  // an absent row AND a stray 'pending'/'missed' row as missed alike.
  // Gated on hasLocation same as everywhere else — without a location we
  // can never know a window really existed to be closed, so nothing here
  // may derive as missed (the "old range is provably closed" claim itself
  // depends on there having been a real window in the first place).
  const hasLocation = profile?.location_lat != null && profile?.location_lng != null;
  let oldQadaMissedCount = 0;
  if (hasLocation && oldQadaRangeStart <= twoDaysAgoStr) {
    const daysInOldRange =
      (new Date(`${twoDaysAgoStr}T00:00:00Z`).getTime() - new Date(`${oldQadaRangeStart}T00:00:00Z`).getTime()) /
        86_400_000 +
      1;
    oldQadaMissedCount = Math.max(0, daysInOldRange * 5 - oldPrayerHandledCount);
  }

  // Recent range (T-1, T): still needs the real window resolve — reuses
  // the same resolvePrayerStatuses + buildQadaBacklog app/(app)/deen/page.tsx
  // uses, given access here rather than duplicated, per spec.
  const recentResolvedStatuses = resolvePrayerStatuses({
    rows: recentPrayerRows,
    dates: [oneDayAgoStr, dateStr],
    lat: profile?.location_lat ?? null,
    lng: profile?.location_lng ?? null,
    timezone,
    calcMethod: (profile?.prayer_calc_method as CalcMethod) || "MWL",
    asrMadhab: (profile?.asr_madhab as AsrMadhab) || "standard",
    now,
    accountCreatedDateStr,
  });
  const recentQadaMissedCount = buildQadaBacklog(recentResolvedStatuses).derivedCount;

  const qadaBacklogCount = oldQadaMissedCount + recentQadaMissedCount;

  const deen: DeenSnapshot = {
    nextPrayer: nextPendingPrayer
      ? { name: nextPendingPrayer, dueAt: windows?.[nextPendingPrayer]?.start.toISOString() ?? null }
      : null,
    prayerStatuses: PRAYER_NAMES.map((name) => ({
      name,
      status: effectiveStatusFor(name),
    })),
    quranWeekPages: quranSessions.reduce((sum, s) => sum + s.pages_read, 0),
    quranWeeklyTarget,
    habitFocusName: weeklyFocusHabit?.name ?? null,
    habitFocusStreak,
    pulse: pulse.deen,
    qadaBacklogCount,
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
    pulse: pulse.co_op,
  };

  return { deen, business, fitness, school, co_op };
}
