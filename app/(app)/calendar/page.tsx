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

/**
 * This week, Sun–Sat, as an hour grid — docs/superpowers/specs/
 * 2026-08-23-schedule-calendar.md §6. Replaces the topbar's profile icon
 * (Engineer A wires that link; this file only needs to exist and render).
 * Classes/work land here first; fitness sessions and cross-domain
 * deadlines are the fast-follow layered on top of this same grid, not a
 * second one.
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

  const [{ data: eventRows }, { data: weeklyGoalsRows }] = await Promise.all([
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
  ]);

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

  return (
    <PageContainer>
      <PageHeader title="This week" />

      <WeeklyGoalsHeader deen={deenGoalRow} business={businessGoalRow} />

      <Panel title="Week">
        <WeekHourGrid items={items} todayDayOfWeek={todayDayOfWeek} />
      </Panel>
    </PageContainer>
  );
}
