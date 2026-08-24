import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, weekDatesFrom, dayOfWeekFromDateString } from "@/lib/date-utils";
import { WeeklyGoalsHeader } from "@/components/shared/weekly-goals-header";
import { WeekHourGrid, type CalendarItem } from "@/components/calendar/week-hour-grid";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";

function minutesFromTimeString(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const DOMAIN_LABEL: Record<"school" | "co_op", string> = { school: "School", co_op: "Work" };

/**
 * This week, Sun–Sat, as an hour grid — docs/superpowers/specs/
 * 2026-08-23-schedule-calendar.md §6. Classes/work, fitness sessions, and
 * cross-domain deadlines all land on the SAME grid, not three separate
 * ones — every source resolves to the same CalendarItem shape.
 */
export default async function CalendarPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const weekDates = weekDatesFrom(weekStart);
  const todayDayOfWeek = dayOfWeekFromDateString(dateStr);

  const [{ data: eventRows }, { data: weeklyGoalsRows }, { data: taskRows }, { data: activePlanRow }] = await Promise.all([
    supabase
      .from("schedule_events")
      .select("id, title, domain, is_recurring, day_of_week, event_date, event_time, end_time, cancelled_on")
      .eq("user_id", userId)
      .in("domain", ["school", "co_op"]),
    supabase
      .from("weekly_goals")
      .select("domain, headline")
      .eq("user_id", userId)
      .eq("week_start_date", weekStart)
      .in("domain", ["deen", "business"]),
    // Deadlines across every domain that has tasks — school + co_op are
    // the only two the schema allows (tasks_domain_check).
    supabase
      .from("tasks")
      .select("id, title, domain, due_date, due_time, completed")
      .eq("user_id", userId)
      .eq("completed", false)
      .in("due_date", weekDates),
    supabase.from("active_workout_plans").select("routine_plan_id").eq("user_id", userId).maybeSingle(),
  ]);

  const routinePlanId = activePlanRow?.routine_plan_id ?? null;
  const { data: sessionRows } = routinePlanId
    ? await supabase
        .from("plan_sessions")
        .select("id, name, schedule_days, start_time, plan_session_exercises(duration_minutes)")
        .eq("plan_id", routinePlanId)
    : { data: [] };

  const deenGoalRow = (weeklyGoalsRows ?? []).find((g) => g.domain === "deen") ?? null;
  const businessGoalRow = (weeklyGoalsRows ?? []).find((g) => g.domain === "business") ?? null;

  const items: CalendarItem[] = [];
  for (const e of eventRows ?? []) {
    if (!e.event_time) continue; // nothing to anchor it to on an hour grid

    let dow: number;
    if (e.is_recurring) {
      if (e.day_of_week === null) continue;
      const dateForThisDay = weekDates[e.day_of_week];
      if (e.cancelled_on === dateForThisDay) continue; // single-date exception
      dow = e.day_of_week;
    } else {
      if (!e.event_date || !weekDates.includes(e.event_date)) continue; // outside this week
      dow = dayOfWeekFromDateString(e.event_date);
    }

    const startMinutes = minutesFromTimeString(e.event_time);
    const durationMinutes = e.end_time ? minutesFromTimeString(e.end_time) - startMinutes : 60;
    items.push({
      id: e.id,
      dayOfWeek: dow,
      title: e.title,
      startMinutes,
      durationMinutes: Math.max(durationMinutes, 15),
      colorVar: e.domain === "school" ? "--series-school" : "--series-coop",
    });
  }

  // Fitness sessions — the active ROUTINE plan's sessions only (micro
  // goals are all-day, not naturally time-anchored on an hour grid).
  // schedule_days is the plan's own 0=Sun..6=Sat convention, same as
  // everywhere else in the fitness system.
  for (const session of sessionRows ?? []) {
    if (!session.start_time) continue;
    const startMinutes = minutesFromTimeString(session.start_time);
    const durationMinutes = (session.plan_session_exercises ?? []).reduce(
      (sum, e) => sum + (e.duration_minutes ?? 0),
      0
    );
    for (const dow of session.schedule_days) {
      items.push({
        id: `${session.id}-${dow}`,
        dayOfWeek: dow,
        title: session.name,
        startMinutes,
        durationMinutes: Math.max(durationMinutes, 15),
        colorVar: "--series-fitness",
      });
    }
  }

  // Deadlines — a task with a due_time is a real point-in-time block
  // (nominal 15-minute band, same convention as Day's Shape's timed
  // tasks); one with only a due_date has nothing to anchor it to on an
  // hour axis, so it's listed separately rather than dropped silently.
  const timedDeadlines = (taskRows ?? []).filter(
    (t): t is typeof t & { due_time: string; due_date: string } => t.due_time !== null && t.due_date !== null
  );
  const undatedTimeDeadlines = (taskRows ?? []).filter((t) => t.due_time === null && t.due_date !== null);
  for (const task of timedDeadlines) {
    const startMinutes = minutesFromTimeString(task.due_time);
    items.push({
      id: `task-${task.id}`,
      dayOfWeek: dayOfWeekFromDateString(task.due_date),
      title: `Due: ${task.title}`,
      startMinutes,
      durationMinutes: 15,
      colorVar: task.domain === "school" ? "--series-school" : "--series-coop",
    });
  }

  return (
    <PageContainer>
      <PageHeader title="This week" />

      <WeeklyGoalsHeader deen={deenGoalRow} business={businessGoalRow} />

      <Panel title="Week">
        <WeekHourGrid items={items} todayDayOfWeek={todayDayOfWeek} />
      </Panel>

      {undatedTimeDeadlines.length > 0 && (
        <Panel title="Also due this week">
          <ul className="flex flex-col gap-1.5">
            {undatedTimeDeadlines.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {DOMAIN_LABEL[t.domain as "school" | "co_op"]} · due {t.due_date}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageContainer>
  );
}
