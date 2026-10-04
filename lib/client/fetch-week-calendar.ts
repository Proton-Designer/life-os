import type { WeekCalendarData } from "@/components/calendar/week-calendar-view";
import { shellFetch } from "@/lib/client/shell-fetch";

/** NAV-02: the calendar dialog's read as a fetch (outside the Server Action queue); see lib/api/shell-read.ts. */
export function fetchWeekCalendar(): Promise<WeekCalendarData> {
  return shellFetch<WeekCalendarData>("/api/shell/week-calendar");
}
