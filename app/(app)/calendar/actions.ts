"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, dayOfWeekFromDateString } from "@/lib/date-utils";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { getCancelledDatesByEvent, isOccurrenceCancelled } from "@/lib/tasks/schedule-cancellations";
import type { CalendarItem } from "@/components/calendar/week-hour-grid";
import type { WeeklyGoalEntry } from "@/components/shared/weekly-goals-header";

export type WeekCalendarData = {
  items: CalendarItem[];
  undatedDeadlines: { id: string; title: string; domainLabel: string; dueDate: string }[];
  deen: WeeklyGoalEntry;
  business: WeeklyGoalEntry;
};

function minutesFromTimeString(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatClockTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(startMinutes: number, durationMinutes: number): string {
  return `${formatClockTime(startMinutes)}–${formatClockTime(startMinutes + durationMinutes)}`;
}

const SCHEDULE_DOMAIN_LABEL: Record<"school" | "co_op", string> = { school: "School", co_op: "Work" };
const TASK_DOMAIN_LABEL: Record<string, string> = { school: "School", co_op: "Work" };

/**
 * The whole week's calendar data, fetched in one Server Action so both
 * homes — the `/calendar` route and the topbar's popup — call the exact
 * same code (spec item C: "one component, two homes"). Fully serializable
 * return value only, per the RSC boundary rule; no functions in here.
 */
export async function getWeekCalendar(): Promise<WeekCalendarData> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);

  const [{ data: eventRows }, { data: weeklyGoalsRows }, { data: taskRows }, { data: activePlanRow }, snapshots] =
    await Promise.all([
      supabase
        .from("schedule_events")
        .select("id, title, domain, is_recurring, day_of_week, event_date, event_time, end_time, location, instructor")
        .eq("user_id", userId)
        .in("domain", ["school", "co_op"]),
      supabase
        .from("weekly_goals")
        .select("domain, headline, milestones, quran_page_target")
        .eq("user_id", userId)
        .eq("week_start_date", weekStart)
        .in("domain", ["deen", "business"]),
      supabase
        .from("tasks")
        .select("id, title, domain, due_date, due_time, completed")
        .eq("user_id", userId)
        .eq("completed", false)
        .in("due_date", weekDates),
      supabase.from("active_workout_plans").select("routine_plan_id").eq("user_id", userId).maybeSingle(),
      getDomainSnapshots(userId, now),
    ]);

  const cancelledDates = await getCancelledDatesByEvent(
    supabase,
    userId,
    (eventRows ?? []).map((e) => e.id)
  );

  const routinePlanId = activePlanRow?.routine_plan_id ?? null;
  const { data: sessionRows } = routinePlanId
    ? await supabase
        .from("plan_sessions")
        .select("id, name, schedule_days, start_time, plan_session_exercises(duration_minutes)")
        .eq("plan_id", routinePlanId)
    : { data: [] };

  const deenGoalRow = (weeklyGoalsRows ?? []).find((g) => g.domain === "deen") ?? null;
  const businessGoalRow = (weeklyGoalsRows ?? []).find((g) => g.domain === "business") ?? null;
  const deen: WeeklyGoalEntry = deenGoalRow
    ? {
        headline: deenGoalRow.headline,
        milestones: (deenGoalRow.milestones as string[] | null) ?? [],
        quranPages: snapshots.deen.quranWeekPages,
        quranTarget: snapshots.deen.quranWeeklyTarget,
      }
    : null;
  const business: WeeklyGoalEntry = businessGoalRow
    ? { headline: businessGoalRow.headline, milestones: (businessGoalRow.milestones as string[] | null) ?? [] }
    : null;

  const items: CalendarItem[] = [];

  for (const e of eventRows ?? []) {
    if (!e.event_time) continue; // nothing to anchor it to on an hour grid

    let dow: number;
    if (e.is_recurring) {
      if (e.day_of_week === null) continue;
      const dateForThisDay = weekDates[e.day_of_week];
      if (isOccurrenceCancelled(cancelledDates, e.id, dateForThisDay)) continue; // single-date exception
      dow = e.day_of_week;
    } else {
      if (!e.event_date || !weekDates.includes(e.event_date)) continue; // outside this week
      dow = dayOfWeekFromDateString(e.event_date);
    }

    const startMinutes = minutesFromTimeString(e.event_time);
    const durationMinutes = e.end_time ? minutesFromTimeString(e.end_time) - startMinutes : 60;
    const domainLabel = SCHEDULE_DOMAIN_LABEL[e.domain as "school" | "co_op"];
    items.push({
      id: e.id,
      dayOfWeek: dow,
      title: e.title,
      startMinutes,
      durationMinutes: Math.max(durationMinutes, 15),
      colorVar: e.domain === "school" ? "--series-school" : "--series-coop",
      kind: e.domain === "school" ? "class" : "work",
      detail: {
        timeRange: formatTimeRange(startMinutes, Math.max(durationMinutes, 15)),
        location: e.location ?? undefined,
        instructor: e.instructor ?? undefined,
        domainLabel,
      },
    });
  }

  // Fitness sessions — the active ROUTINE plan's sessions only (micro
  // goals are all-day, not naturally time-anchored on an hour grid).
  for (const session of sessionRows ?? []) {
    if (!session.start_time) continue;
    const startMinutes = minutesFromTimeString(session.start_time);
    const durationMinutes = Math.max(
      (session.plan_session_exercises ?? []).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0),
      15
    );
    for (const dow of session.schedule_days) {
      items.push({
        id: `${session.id}-${dow}`,
        dayOfWeek: dow,
        title: session.name,
        startMinutes,
        durationMinutes,
        colorVar: "--series-fitness",
        kind: "fitness",
        detail: {
          timeRange: formatTimeRange(startMinutes, durationMinutes),
          domainLabel: "Fitness",
        },
      });
    }
  }

  // Deadlines — a task with a due_time is a real point-in-time block
  // (nominal 15-minute band); one with only a due_date has nothing to
  // anchor it to on an hour axis, so it's listed separately.
  const timedDeadlines = (taskRows ?? []).filter(
    (t): t is typeof t & { due_time: string; due_date: string } => t.due_time !== null && t.due_date !== null
  );
  const undatedDeadlineRows = (taskRows ?? []).filter((t) => t.due_time === null && t.due_date !== null);
  for (const task of timedDeadlines) {
    const startMinutes = minutesFromTimeString(task.due_time);
    const domainLabel = TASK_DOMAIN_LABEL[task.domain] ?? task.domain;
    items.push({
      id: `task-${task.id}`,
      dayOfWeek: dayOfWeekFromDateString(task.due_date),
      title: `Due: ${task.title}`,
      startMinutes,
      durationMinutes: 15,
      colorVar: task.domain === "school" ? "--series-school" : "--series-coop",
      kind: "task",
      detail: {
        timeRange: formatClockTime(startMinutes),
        domainLabel,
      },
    });
  }

  const undatedDeadlines = undatedDeadlineRows.map((t) => ({
    id: t.id,
    title: t.title,
    domainLabel: TASK_DOMAIN_LABEL[t.domain] ?? t.domain,
    dueDate: t.due_date as string,
  }));

  return { items, undatedDeadlines, deen, business };
}
