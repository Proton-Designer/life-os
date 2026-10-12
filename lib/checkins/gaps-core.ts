import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayOfWeekFromDateString, resolveLocalTime, addDaysToDateString } from "@/lib/date-utils";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { computePrayerWindows } from "@/lib/prayer-times/windows";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { getCancelledDatesByEvent, isOccurrenceCancelled } from "@/lib/tasks/schedule-cancellations";
import { NOMINAL_WORKOUT_MINUTES } from "./prefill";
import { prayerSuppressionRanges, type TimeRange } from "./schedule";
import { allocationForChoice, computeUntrackedGaps, validateGapAnswers, type Gap, type GapAnswer, type GapChoice } from "./gaps";

/**
 * "Your untracked time" (evening close): the stretches of a day no session, prayer, workout or check-in accounts for, and
 * saving the person's one-tap answers. `core(supabase, userId, ...)` shape: never touches cookies, `now` is a parameter.
 *
 * An answer is stored as an ordinary allocation check-in (the save_allocation_checkin RPC) whose window is the stretch, so
 * every reader of checkins / checkin_allocations (Signal:Noise, the focus map, the KPIs) sees it with no change, and a
 * stretch that is answered is, by the same rule, no longer a gap (its window is a stored check-in span).
 */

export type GapHint = { title: string; choice: GapChoice };
export type UntrackedGap = { start: string; end: string; minutes: number; hint: GapHint | null };
export type UntrackedGapsResult = { gaps: UntrackedGap[]; timezone: string; deenMode: boolean };

type ProfileRow = {
  timezone: string;
  checkin_window_start: string;
  checkin_window_end: string;
  location_lat: number | null;
  location_lng: number | null;
  prayer_calc_method: string;
  asr_madhab: string;
  deen_mode: boolean | null;
};

type EventRow = { id: string; title: string; domain: string; is_recurring: boolean; event_time: string | null; end_time: string | null };

async function loadGaps(
  supabase: SupabaseClient,
  userId: string,
  dateStr: string,
  now: Date,
): Promise<{ gaps: Gap[]; hints: Map<number, GapHint>; profile: ProfileRow } | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, checkin_window_start, checkin_window_end, location_lat, location_lng, prayer_calc_method, asr_madhab, deen_mode")
    .eq("user_id", userId)
    .maybeSingle<ProfileRow>();
  if (!profile) return null;

  const timezone = profile.timezone;
  const deenMode = isDeenModeOn(profile);
  const dayStart = resolveLocalTime(dateStr, "00:00", timezone);
  const dayEnd = resolveLocalTime(addDaysToDateString(dateStr, 1), "00:00", timezone);
  const dow = dayOfWeekFromDateString(dateStr);

  const [sessions, answered, workoutRows, workoutSchedule, events] = await Promise.all([
    supabase
      .from("work_sessions")
      .select("started_at, ended_at")
      .eq("user_id", userId)
      .eq("counts_toward_hours", true) // migration 057
      .lt("started_at", dayEnd.toISOString())
      .or(`ended_at.is.null,ended_at.gte.${dayStart.toISOString()}`),
    supabase
      .from("checkins")
      .select("window_start, window_end")
      .eq("user_id", userId)
      .eq("kind", "allocation")
      .gte("window_start", dayStart.toISOString())
      .lt("window_start", dayEnd.toISOString()),
    supabase.from("workout_sessions").select("id").eq("user_id", userId).eq("date", dateStr).limit(1),
    supabase.from("workout_schedule").select("time, duration_minutes").eq("user_id", userId).eq("day_of_week", dow).maybeSingle(),
    supabase
      .from("schedule_events")
      .select("id, title, domain, is_recurring, event_time, end_time")
      .eq("user_id", userId)
      .in("domain", ["school", "co_op"])
      .or(`and(is_recurring.eq.true,day_of_week.eq.${dow}),and(is_recurring.eq.false,event_date.eq.${dateStr})`),
  ]);

  const covered: TimeRange[] = [];
  for (const s of sessions.data ?? []) covered.push({ start: new Date(s.started_at), end: s.ended_at ? new Date(s.ended_at) : null });
  for (const c of answered.data ?? []) if (c.window_start && c.window_end) covered.push({ start: new Date(c.window_start), end: new Date(c.window_end) });

  // A workout that was logged today is covered for its scheduled slot (its real clock time isn't recorded).
  if ((workoutRows.data ?? []).length > 0 && workoutSchedule.data?.time) {
    const start = resolveLocalTime(dateStr, workoutSchedule.data.time, timezone);
    covered.push({ start, end: new Date(start.getTime() + (workoutSchedule.data.duration_minutes ?? NOMINAL_WORKOUT_MINUTES) * 60_000) });
  }

  // A short nominal span around each prayer time (Faith on, location known).
  if (deenMode && profile.location_lat !== null && profile.location_lng !== null) {
    const windows = computePrayerWindows({
      date: resolveLocalTime(dateStr, "12:00", timezone),
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezone,
      calcMethod: profile.prayer_calc_method as CalcMethod,
      asrMadhab: profile.asr_madhab as AsrMadhab,
    });
    const times = Object.values(windows)
      .filter((w): w is { start: Date; end: Date } => w !== null)
      .map((w) => w.start);
    covered.push(...prayerSuppressionRanges(times));
  }

  const gaps = computeUntrackedGaps({
    dateStr,
    bounds: { wakeTime: profile.checkin_window_start.slice(0, 5), sleepTime: profile.checkin_window_end.slice(0, 5) },
    timezone,
    covered,
    now,
  });

  // Hints: a class / work block on the schedule that overlaps a stretch ("Calculus -- did you go?").
  const eventRows = (events.data ?? []) as EventRow[];
  const cancelled = eventRows.length > 0 ? await getCancelledDatesByEvent(supabase, userId, eventRows.map((e) => e.id)) : new Map();
  const hints = new Map<number, GapHint>();
  gaps.forEach((gap, i) => {
    let best: { overlap: number; hint: GapHint } | null = null;
    for (const e of eventRows) {
      if (!e.event_time || isOccurrenceCancelled(cancelled, e.id, dateStr)) continue;
      const start = resolveLocalTime(dateStr, e.event_time, timezone).getTime();
      const end = e.end_time ? resolveLocalTime(dateStr, e.end_time, timezone).getTime() : start + 60 * 60_000;
      const overlap = Math.min(end, gap.end.getTime()) - Math.max(start, gap.start.getTime());
      if (overlap >= 15 * 60_000 && (!best || overlap > best.overlap)) best = { overlap, hint: { title: e.title, choice: e.domain === "school" ? "school" : "co_op" } };
    }
    if (best) hints.set(i, best.hint);
  });

  return { gaps, hints, profile };
}

/** The untracked stretches of `dateStr` for the person, each with a schedule hint when one fits. */
export async function loadUntrackedGapsCore(supabase: SupabaseClient, userId: string, dateStr: string, now: Date): Promise<UntrackedGapsResult | null> {
  const loaded = await loadGaps(supabase, userId, dateStr, now);
  if (!loaded) return null;
  return {
    gaps: loaded.gaps.map((g, i) => ({ start: g.start.toISOString(), end: g.end.toISOString(), minutes: g.minutes, hint: loaded.hints.get(i) ?? null })),
    timezone: loaded.profile.timezone,
    deenMode: isDeenModeOn(loaded.profile),
  };
}

/**
 * Saves answers for `dateStr`. Each is checked against the stretches worked out here (never trusted from the client), then
 * stored through the same RPC the check-in uses. A neutral answer ('rest' / 'errands') holds no minutes; its label says what it was.
 */
export async function saveGapAnswersCore(
  supabase: SupabaseClient,
  userId: string,
  dateStr: string,
  now: Date,
  answers: readonly GapAnswer[],
): Promise<{ saved: number }> {
  if (answers.length === 0) return { saved: 0 };
  if (answers.length > 40) throw new Error("Too many answers at once.");
  const loaded = await loadGaps(supabase, userId, dateStr, now);
  if (!loaded) throw new Error("No profile yet.");
  const checked = validateGapAnswers(loaded.gaps, answers, { allowFaith: isDeenModeOn(loaded.profile) });
  if (!checked.ok) throw new Error(checked.message);

  for (const a of checked.answers) {
    const { allocation, wastedMinutes } = allocationForChoice(a.choice, a.minutes);
    const { data, error } = await supabase.rpc("save_allocation_checkin", {
      p_window_start: a.start.toISOString(),
      p_window_end: a.end.toISOString(),
      p_allocations: allocation,
      p_wasted_minutes: wastedMinutes,
    });
    if (error) throw error;
    if (a.choice === "rest" || a.choice === "errands") {
      const { error: labelError } = await supabase.from("checkins").update({ gap_label: a.choice }).eq("id", data as string).eq("user_id", userId);
      if (labelError) throw labelError;
    }
  }
  return { saved: checked.answers.length };
}
