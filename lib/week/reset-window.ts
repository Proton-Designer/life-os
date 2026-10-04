import { addDaysToDateString, getWeekStartDate, localDateString, resolveLocalTime } from "@/lib/date-utils";

/**
 * The weekly-reset window (IA-P3): the user's LOCAL Sunday 00:00 until Monday 12:00. Weeks are
 * Sunday-start (getWeekStartDate), so "Sunday 00:00" is the first instant of the new week. Both
 * edges come from resolveLocalTime on local date strings — never a raw Date's getDay()/UTC parts.
 */
export function isWeeklyResetWindow(now: Date, timezone: string): boolean {
  const weekStart = getWeekStartDate(localDateString(now, timezone));
  const start = resolveLocalTime(weekStart, "00:00", timezone);
  const end = resolveLocalTime(addDaysToDateString(weekStart, 1), "12:00", timezone);
  return now.getTime() >= start.getTime() && now.getTime() < end.getTime();
}

/**
 * Where the retired /weekly-review goes: the reset flow while its window is open, otherwise the
 * Insights Week tab (carrying the "so far" view when asked for).
 */
export function weeklyReviewRedirectTarget(now: Date, timezone: string, view?: string): string {
  if (isWeeklyResetWindow(now, timezone) && view !== "so-far") return "/week";
  return view === "so-far" ? "/insights?tab=week&view=so-far" : "/insights?tab=week";
}
