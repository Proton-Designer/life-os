import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import { localDateString, dayOfWeekFromDateString, resolveLocalTime, addDaysToDateString } from "@/lib/date-utils";
import { getCancelledDatesByEvent, isOccurrenceCancelled } from "@/lib/tasks/schedule-cancellations";
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
// due instant, not a tracked duration. schedule_events (042) DOES carry a
// real end_time for classes/work seeded via scripts/seed-schedule.ts — the
// nominal 60-minute fallback below only applies to an event added through
// the generic "add schedule event" UI, which still doesn't collect one.
const NOMINAL_WORKOUT_MS = 45 * 60_000;
const NOMINAL_TASK_MS = 15 * 60_000;
const NOMINAL_SCHEDULE_EVENT_MS = 60 * 60_000;

function formatTimeRange(start: Date, end: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  return `${fmt.format(start)}–${fmt.format(end)}`;
}

export type DayShapeProfile = {
  location_lat: number | null;
  location_lng: number | null;
  timezone: string;
  prayer_calc_method: string;
  asr_madhab: string;
  /** "HH:MM[:SS]" local clock time — A3 Part 1: the day axis's own bounds,
   * same columns lib/checkins/schedule.ts already reuses as WakeSleepBounds
   * (NOT NULL with DB defaults 08:00/22:00, so every account — including
   * one that predates the Rhythm onboarding screen — already has usable
   * values; no migration, no absent-state to design for). */
  checkin_window_start: string;
  checkin_window_end: string;
};
export type DayShapePrayerRow = { prayer_name: string; status: string };
export type DayShapeWorkoutSchedule = { workout_name: string; time: string | null };
export type DayShapeTaskRow = { title: string; domain: "school" | "co_op"; due_time: string };
export type DayShapeSessionRow = { started_at: string; ended_at: string | null; kind: "deep_work" | "deep_study" };
export type DayShapeScheduleEventRow = {
  id: string;
  title: string;
  domain: string;
  is_recurring: boolean;
  day_of_week: number | null;
  event_date: string | null;
  event_time: string | null;
  end_time: string | null;
  location: string | null;
  instructor: string | null;
  /** Whether TODAY's occurrence of this event is cancelled — resolved from schedule_event_cancellations (migration 046), never the deprecated `cancelled_on` column. */
  cancelled: boolean;
};

export type DayShapeDataSource = {
  getProfile: (userId: string) => Promise<DayShapeProfile | null>;
  getPrayers: (userId: string, date: string) => Promise<DayShapePrayerRow[]>;
  getWorkoutSchedule: (userId: string, dayOfWeek: number) => Promise<DayShapeWorkoutSchedule | null>;
  getTimedTasks: (userId: string, date: string) => Promise<DayShapeTaskRow[]>;
  getFocusSessions: (userId: string, date: string, timezone: string) => Promise<DayShapeSessionRow[]>;
  /** Today's recurring + one-off schedule_events (classes, work) — school and co_op domains only. */
  getScheduleEvents: (userId: string, date: string, dayOfWeek: number) => Promise<DayShapeScheduleEventRow[]>;
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
        checkin_window_start: profile.checkin_window_start,
        checkin_window_end: profile.checkin_window_end,
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
        .select("started_at, ended_at, kind")
        .eq("user_id", userId)
        .gte("started_at", dayStart)
        .lt("started_at", dayEnd)
        // Deep-work-class only. The ribbon maps every work_sessions row to the
        // "focus" activity kind, so once 'learn' is storable a 7-minute
        // retrieval review would render on the day timeline as a Focus block —
        // mislabelling it as deep work in the one surface whose job is showing
        // the shape of the day honestly. The cast below would also be a lie.
        //
        // FOLLOW-UP, deliberately not done here: showing reviews on the ribbon
        // is desirable (D-003 wants Home to answer "what did I do today"), but
        // it needs its OWN RibbonActivityKind with its own icon and label, not
        // a borrowed one. Omitting is honest; mislabelling is not.
        .eq("counts_toward_hours", true);
      return (data ?? []) as DayShapeSessionRow[];
    },
    async getScheduleEvents(userId, date, dayOfWeek) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("schedule_events")
        .select("id, title, domain, is_recurring, day_of_week, event_date, event_time, end_time, location, instructor")
        .eq("user_id", userId)
        .in("domain", ["school", "co_op"])
        .or(`and(is_recurring.eq.true,day_of_week.eq.${dayOfWeek}),and(is_recurring.eq.false,event_date.eq.${date})`);
      const rows = data ?? [];
      const cancelledDates = await getCancelledDatesByEvent(
        supabase,
        userId,
        rows.map((r) => r.id)
      );
      return rows.map((r) => ({ ...r, cancelled: isOccurrenceCancelled(cancelledDates, r.id, date) }));
    },
  };
}

// DB defaults for profiles.checkin_window_start/end (NOT NULL columns) —
// used only when there's no profile row at all (an edge case `getProfile`
// already treats as possible via its `| null` return), so a missing row
// produces the exact same day bounds a real row with untouched defaults
// would. Not a "fallback in case a real value is absent" — every real row
// already has a value.
const DEFAULT_WAKE_TIME = "08:00";
const DEFAULT_SLEEP_TIME = "22:00";

/**
 * Today's prayers as windows+derived-status, the day's other activity
 * blocks (scheduled workout, timed School/Work tasks, focus/Lock-In
 * sessions), and the day axis's own wake->sleep bounds (A3 Part 1) — the
 * raw material for DayRibbon. Genuinely new data assembly, not a re-render
 * of the old point-marker version: this is the one place "here's my whole
 * day's shape" exists cross-domain in the app.
 */
export async function getDayShape(
  userId: string,
  now: Date,
  dataSource: DayShapeDataSource = defaultDataSource()
): Promise<{ prayers: RibbonPrayerInput[]; activities: RibbonActivityInput[]; dayBounds: { start: Date; end: Date } }> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  // resolveLocalTime, not `${dateStr}T${time}Z` — see AGENTS.md's timezone
  // entry. computeDayRibbon owns the overnight-wrap/degenerate handling;
  // this is just the two resolved instants, same-day, unwrapped.
  const dayBounds = {
    start: resolveLocalTime(dateStr, (profile?.checkin_window_start ?? DEFAULT_WAKE_TIME).slice(0, 5), timezone),
    end: resolveLocalTime(dateStr, (profile?.checkin_window_end ?? DEFAULT_SLEEP_TIME).slice(0, 5), timezone),
  };

  const dayOfWeek = dayOfWeekFromDateString(dateStr);
  const [prayerRows, workoutSchedule, timedTasks, focusSessions, scheduleEvents] = await Promise.all([
    dataSource.getPrayers(userId, dateStr),
    dataSource.getWorkoutSchedule(userId, dayOfWeek),
    dataSource.getTimedTasks(userId, dateStr),
    dataSource.getFocusSessions(userId, dateStr, timezone),
    dataSource.getScheduleEvents(userId, dateStr, dayOfWeek),
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
      kind: "fitness",
      start,
      end: new Date(start.getTime() + NOMINAL_WORKOUT_MS),
    });
  }

  for (const task of timedTasks) {
    const start = resolveLocalTime(dateStr, task.due_time, timezone);
    activities.push({
      label: task.title,
      colorVar: task.domain === "school" ? "--series-school" : "--series-coop",
      kind: "task",
      start,
      end: new Date(start.getTime() + NOMINAL_TASK_MS),
    });
  }

  for (const session of focusSessions) {
    activities.push({
      // migration 044 (Engineer A, 2026-08-24): work_sessions now splits
      // into "deep_work"/"deep_study" — every pre-existing row backfilled
      // to deep_work, so this is never undefined for a real row.
      label: session.kind === "deep_study" ? "Deep Study" : "Deep Work",
      colorVar: "--series-business",
      kind: "focus",
      start: new Date(session.started_at),
      end: session.ended_at ? new Date(session.ended_at) : null,
    });
  }

  // Classes and work — a new SOURCE for the existing activity-block
  // mechanism, not a new one (overnight session 2026-08-23/24). A class
  // cancelled for today's specific occurrence must not render at all, same
  // rule the School page enforces (§3 of the spec) — `cancelled` above is
  // already resolved against schedule_event_cancellations (migration 046),
  // not the deprecated `cancelled_on` column.
  for (const event of scheduleEvents) {
    if (!event.event_time || event.cancelled) continue;
    const start = resolveLocalTime(dateStr, event.event_time, timezone);
    const end = event.end_time
      ? resolveLocalTime(dateStr, event.end_time, timezone)
      : new Date(start.getTime() + NOMINAL_SCHEDULE_EVENT_MS);
    activities.push({
      label: event.title,
      colorVar: event.domain === "school" ? "--series-school" : "--series-coop",
      kind: event.domain === "school" ? "class" : "work",
      start,
      end,
      detail: {
        title: event.title,
        timeRange: formatTimeRange(start, end, timezone),
        location: event.location ?? undefined,
        instructor: event.instructor ?? undefined,
        domain: event.domain,
      },
    });
  }

  return { prayers, activities, dayBounds };
}
