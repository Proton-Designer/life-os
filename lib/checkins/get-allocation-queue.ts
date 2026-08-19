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
import { derivePrefillAllocation } from "./prefill";
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
  getWorkoutTime: (userId: string, dateStr: string, timezone: string) => Promise<Date | null>;
  getAnsweredWindowStarts: (userId: string, dateStr: string, timezone: string) => Promise<Date[]>;
  /** Prayer names logged today with a real (non-missed, non-pending) status — the caller maps these to actual clock times via computePrayerWindows. */
  getLoggedPrayerNames: (userId: string, dateStr: string) => Promise<string[]>;
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
    async getWorkoutTime(userId, dateStr, timezone) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("workout_schedule")
        .select("time")
        .eq("user_id", userId)
        .eq("day_of_week", dayOfWeekFromDateString(dateStr))
        .maybeSingle();
      if (!data?.time) return null;
      return resolveLocalTime(dateStr, data.time, timezone);
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

  const [lockInSessions, workoutTime, answeredWindowStarts, loggedPrayerNames] = await Promise.all([
    dataSource.getWorkSessions(userId, dateStr, timezone),
    dataSource.getWorkoutTime(userId, dateStr, timezone),
    dataSource.getAnsweredWindowStarts(userId, dateStr, timezone),
    dataSource.getLoggedPrayerNames(userId, dateStr),
  ]);

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
  });

  const pending = pendingQueue(slots);

  const items: PendingAllocationItem[] = pending.map((slot) => {
    const prefill = derivePrefillAllocation(slot.window, {
      lockInSessions,
      loggedPrayerTimes,
      workoutTime,
    });
    return {
      windowStartIso: slot.window.start.toISOString(),
      windowEndIso: slot.window.end.toISOString(),
      prefill,
    };
  });

  return { items, unknownCount: unknownCount(slots), timezone };
}
