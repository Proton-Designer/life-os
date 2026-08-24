import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, dayOfWeekFromDateString } from "@/lib/date-utils";
import { getWeekCalendar } from "./actions";
import { saveWeeklyGoal } from "@/app/(app)/actions";
import { WeekCalendarView } from "@/components/calendar/week-calendar-view";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";

/**
 * This week, Sun–Sat, as an hour grid — docs/superpowers/specs/
 * 2026-08-23-schedule-calendar.md §6, restructured 2026-08-24 (Ayman:
 * "the calendar view structure/setup is incorrect ... should be a popup").
 * The route survives as its own page (e2e/zz-overnight-verify.spec.ts
 * asserts on it) rendering the exact same WeekCalendarView the topbar's
 * dialog renders — only the data-fetching wrapper differs: this page fetches
 * server-side on render, the dialog fetches client-side on first open via
 * the same getWeekCalendar Server Action.
 */
export default async function CalendarPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(new Date(), timezone);
  const todayDayOfWeek = dayOfWeekFromDateString(dateStr);

  const data = await getWeekCalendar();

  return (
    <PageContainer>
      <PageHeader title="This week" />
      <WeekCalendarView
        data={data}
        todayDayOfWeek={todayDayOfWeek}
        onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
        onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
      />
    </PageContainer>
  );
}
