import { createClient } from "@/lib/supabase/server";
import { localDateString, dayOfWeekFromDateString, resolveLocalTime } from "@/lib/date-utils";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { computePrayerWindows } from "@/lib/prayer-times/windows";
import {
  resolveAllocationSlots,
  pendingQueue,
  unknownCount,
  prayerSuppressionRanges,
  type AllocationSlot,
  type TimeRange,
  type WakeSleepBounds,
} from "./schedule";
import { derivePrefillAllocation, subtractResolvedHours } from "./prefill";
import { resolveSessionHours, resolvedHourRanges } from "./session-hour-status";
import type { Allocation } from "./allocation";

export type PendingAllocationItem = {
  windowStartIso: string;
  windowEndIso: string;
  prefill: Allocation;
};

export type AllocationQueueResult = {
  items: PendingAllocationItem[];
  unknownCount: number;
  timezone: string;
};

export type AllocationQueueDataSource = {
  getProfile: (userId: string) => Promise<{
    timezone: string;
    checkin_window_start: string;
    checkin_window_end: string;
    location_lat: number | null;
    location_lng: number | null;
    prayer_calc_method: string;
    asr_madhab: string;
  } | null>;
  getWorkSessions: (userId: string, dateStr: string, timezone: string) => Promise<TimeRange[]>;
  /** durationMinutes is null when the schedule row hasn't set one (023_workout_schedule_duration.sql) — derivePrefillAllocation falls back to its own nominal default. */
  getWorkoutSchedule: (
    userId: string,
    dateStr: string,
    timezone: string
  ) => Promise<{ time: Date; durationMinutes: number | null } | null>;
  getAnsweredWindowStarts: (userId: string, dateStr: string, timezone: string) => Promise<Date[]>;
  /** Prayer names logged today with a real (non-missed, non-pending) status — the caller maps these to actual clock times via computePrayerWindows. */
  getLoggedPrayerNames: (userId: string, dateStr: string) => Promise<string[]>;
  /** EVIDENCE: a workout_sessions row exists for `dateStr` (Fitness redesign, 2026-08-20 — repointed off the dropped `workout_logs`) — checked against `date`, never `created_at` (when it was recorded, not when it was performed). Every workout_sessions row (confirmed, adhoc, or quick) represents something that actually happened, unlike the old table's `completed` flag, which this table has no equivalent of because there's no "planned but not done" row shape here. */
  getWorkoutLoggedToday: (userId: string, dateStr: string) => Promise<boolean>;
  /** Today's Lock-In sessions with their own identity — needed to group stored hours per session for resolveSessionHours. */
  getSessionsForHourResolution: (
    userId: string,
    dateStr: string,
    timezone: string
  ) => Promise<{ id: string; startedAt: Date; endedAt: Date | null }[]>;
  /** Every stored (explicitly answered or edited) hourly Lock-In row for `dateStr`, with its session and real domain. */
  getStoredSessionHours: (
    userId: string,
    dateStr: string,
    timezone: string
  ) => Promise<{ sessionId: string; hourStartIso: string; domain: "business" | "wasted" }[]>;
};

function defaultDataSource(): AllocationQueueDataSource {
  return {
    async getProfile(userId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select(
          "timezone, checkin_window_start, checkin_window_end, location_lat, location_lng, prayer_calc_method, asr_madhab"
        )
        .eq("user_id", userId)
        .maybeSingle();
      return data ?? null;
    },
    async getWorkSessions(userId, dateStr, timezone) {
      const supabase = await createClient();
      const dayStart = resolveLocalTime(dateStr, "00:00", timezone).toISOString();
      const dayEnd = new Date(resolveLocalTime(dateStr, "00:00", timezone).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("work_sessions")
        .select("started_at, ended_at")
        .eq("user_id", userId)
        .gte("started_at", dayStart)
        .lt("started_at", dayEnd);
      return (data ?? []).map((s) => ({
        start: new Date(s.started_at),
        end: s.ended_at ? new Date(s.ended_at) : null,
      }));
    },
    async getWorkoutSchedule(userId, dateStr, timezone) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("time, duration_minutes")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeekFromDateString(dateStr))
        .maybeSingle();
      if (!data?.time) return null;
      return { time: resolveLocalTime(dateStr, data.time, timezone), durationMinutes: data.duration_minutes };
    },
    async getAnsweredWindowStarts(userId, dateStr, timezone) {
      const supabase = await createClient();
      const dayStart = resolveLocalTime(dateStr, "00:00", timezone).toISOString();
      const dayEnd = new Date(resolveLocalTime(dateStr, "00:00", timezone).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("checkins")
        .select("window_start")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .gte("window_start", dayStart)
        .lt("window_start", dayEnd);
      return (data ?? []).filter((r) => r.window_start).map((r) => new Date(r.window_start as string));
    },
    async getLoggedPrayerNames(userId, dateStr) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("prayer_name")
        .eq("user_id", userId)
        .eq("date", dateStr)
        .in("status", ["on_time", "qada"]);
      return (data ?? []).map((r) => r.prayer_name);
    },
    async getWorkoutLoggedToday(userId, dateStr) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("date", dateStr)
        .limit(1);
      return (data ?? []).length > 0;
    },
    async getSessionsForHourResolution(userId, dateStr, timezone) {
      const supabase = await createClient();
      const dayStart = resolveLocalTime(dateStr, "00:00", timezone).toISOString();
      const dayEnd = new Date(resolveLocalTime(dateStr, "00:00", timezone).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("work_sessions")
        .select("id, started_at, ended_at")
        .eq("user_id", userId)
        .gte("started_at", dayStart)
        .lt("started_at", dayEnd);
      return (data ?? []).map((s) => ({
        id: s.id,
        startedAt: new Date(s.started_at),
        endedAt: s.ended_at ? new Date(s.ended_at) : null,
      }));
    },
    async getStoredSessionHours(userId, dateStr, timezone) {
      const supabase = await createClient();
      const dayStart = resolveLocalTime(dateStr, "00:00", timezone).toISOString();
      const dayEnd = new Date(resolveLocalTime(dateStr, "00:00", timezone).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("checkins")
        .select("window_start, work_session_id, checkin_allocations(domain)")
        .eq("user_id", userId)
        .eq("kind", "allocation")
        .eq("answered", true)
        .not("work_session_id", "is", null)
        .gte("window_start", dayStart)
        .lt("window_start", dayEnd);
      return (data ?? [])
        .filter(
          (r): r is { window_start: string; work_session_id: string; checkin_allocations: { domain: string }[] } =>
            r.window_start !== null && r.work_session_id !== null && r.checkin_allocations.length > 0
        )
        .map((r) => ({
          sessionId: r.work_session_id,
          hourStartIso: r.window_start,
          domain: r.checkin_allocations[0].domain as "business" | "wasted",
        }));
    },
  };
}

/**
 * Assembles today's pending allocation queue (Phase 3's `pendingQueue`) plus
 * a real, data-derived pre-fill for each window — the "wiring" the spec's
 * Phase 1-3 handoff left unassigned: schedule.ts and prefill.ts are pure and
 * know nothing about Supabase.
 *
 * Suppression ranges feed resolveAllocationSlots as Lock-In sessions plus a
 * short nominal span around every one of today's prayer times
 * (prayerSuppressionRanges, schedule.ts) — deliberately NOT the full
 * multi-hour validity window computePrayerWindows returns, which would
 * silence most of the afternoon (Dhuhr's window alone runs 3+ hours).
 */
export async function getPendingAllocationQueue(
  userId: string,
  now: Date,
  dataSource: AllocationQueueDataSource = defaultDataSource()
): Promise<AllocationQueueResult> {
  const profile = await dataSource.getProfile(userId);
  if (!profile) return { items: [], unknownCount: 0, timezone: "UTC" };

  const timezone = profile.timezone;
  const dateStr = localDateString(now, timezone);
  const bounds: WakeSleepBounds = {
    wakeTime: profile.checkin_window_start.slice(0, 5),
    sleepTime: profile.checkin_window_end.slice(0, 5),
  };

  const [
    lockInSessions,
    workoutSchedule,
    answeredWindowStarts,
    loggedPrayerNames,
    workoutLoggedToday,
    sessionsForHourResolution,
    storedSessionHours,
  ] = await Promise.all([
    dataSource.getWorkSessions(userId, dateStr, timezone),
    dataSource.getWorkoutSchedule(userId, dateStr, timezone),
    dataSource.getAnsweredWindowStarts(userId, dateStr, timezone),
    dataSource.getLoggedPrayerNames(userId, dateStr),
    dataSource.getWorkoutLoggedToday(userId, dateStr),
    dataSource.getSessionsForHourResolution(userId, dateStr, timezone),
    dataSource.getStoredSessionHours(userId, dateStr, timezone),
  ]);

  // Every RESOLVED hour (explicitly answered/edited, or auto-derived
  // missed once a newer slot superseded it) across today's sessions —
  // docs/superpowers/specs/2026-08-19-missed-lockin-hours.md. A missed
  // hour has no stored row (session-hour-status.ts's whole point: derive,
  // don't write with a job) but still has a definite value that must be
  // subtracted from the coarse Lock-In overlap credit and must stop a
  // fully-covered window from being queued again.
  const resolvedSessionHourRanges: TimeRange[] = sessionsForHourResolution.flatMap((session) => {
    const storedForSession = storedSessionHours.filter((h) => h.sessionId === session.id);
    const resolved = resolveSessionHours(session, 60, now, storedForSession);
    return resolvedHourRanges(resolved, 60);
  });
  const scheduledWorkoutTime = workoutSchedule?.time ?? null;
  const scheduledWorkoutDurationMinutes = workoutSchedule?.durationMinutes ?? null;

  // Prayer TIMES (window.start), not the hours-long validity windows
  // computePrayerWindows returns (Dhuhr's is ~220min, Isha's ~472min) — a
  // prior version of this file passed the raw windows straight through as
  // pre-fill overlap ranges, which credited Deen with the entire window's
  // overlap (~105/120 min on every afternoon check-in) regardless of
  // whether a prayer was ever actually logged. Found by the Opus Lead's
  // review against Ayman's real coordinates before this shipped.
  //
  // Two different sets, per schedule.ts's own split: `loggedPrayerTimes`
  // (pre-fill, only prayers actually logged on_time/qada) vs every one of
  // today's computed prayer times (suppression, prospective — applies
  // whether or not it's been logged yet — via prayerSuppressionRanges).
  let loggedPrayerTimes: Date[] = [];
  let allPrayerTimes: Date[] = [];
  if (profile.location_lat !== null && profile.location_lng !== null) {
    const windows = computePrayerWindows({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezone,
      calcMethod: profile.prayer_calc_method as CalcMethod,
      asrMadhab: profile.asr_madhab as AsrMadhab,
    });
    allPrayerTimes = Object.values(windows)
      .filter((w): w is { start: Date; end: Date } => w !== null)
      .map((w) => w.start);
    loggedPrayerTimes = loggedPrayerNames
      .map((name) => windows[name as keyof typeof windows]?.start ?? null)
      .filter((d): d is Date => d !== null);
  }

  const suppressionRanges: TimeRange[] = [...lockInSessions, ...prayerSuppressionRanges(allPrayerTimes)];

  const slots: AllocationSlot[] = resolveAllocationSlots({
    dateStr,
    bounds,
    timezone,
    suppressionRanges,
    now,
    answeredWindowStarts,
    confirmedSessionHourRanges: resolvedSessionHourRanges,
  });

  const pending = pendingQueue(slots);

  // Every resolved hour (explicitly answered/edited, or auto-derived
  // missed) is removed from the coarse session-overlap credit before it
  // reaches pre-fill — an hour with its own precise, definite value must
  // never also be coarse-credited for the same 60 minutes on either side.
  // See subtractResolvedHours's own header in prefill.ts.
  const adjustedLockInSessions = subtractResolvedHours(lockInSessions, resolvedSessionHourRanges);

  const items: PendingAllocationItem[] = pending.map((slot) => {
    const prefill = derivePrefillAllocation(slot.window, {
      lockInSessions: adjustedLockInSessions,
      loggedPrayerTimes,
      workoutLoggedToday,
      scheduledWorkoutTime,
      scheduledWorkoutDurationMinutes,
    });
    return {
      windowStartIso: slot.window.start.toISOString(),
      windowEndIso: slot.window.end.toISOString(),
      prefill,
    };
  });

  return { items, unknownCount: unknownCount(slots), timezone };
}
