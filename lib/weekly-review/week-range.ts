import { getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";

/** A half-open local date range: `[startDate, endDateExclusive)`, both YYYY-MM-DD. */
export type WeekRange = { startDate: string; endDateExclusive: string };

/**
 * The most recently COMPLETED Sun-Sat week as of `todayStr` (ruled
 * 2026-09-14: "the app's weeks are Sunday-start... default view = the most
 * recently completed Sun-Sat week, so on Sunday it shows the week that just
 * ended -- which is what 'Sunday review' means").
 *
 * `getWeekStartDate` always rounds down to the most recent Sunday --
 * `todayStr` itself, if today IS Sunday -- so subtracting 7 days gives the
 * PRIOR week's Sunday uniformly regardless of what day today is: on a
 * Sunday this is exactly last week; on any other day it is still the last
 * fully-completed week, not a partial one ending today.
 */
export function getMostRecentCompletedWeek(todayStr: string): WeekRange {
  const thisWeekStart = getWeekStartDate(todayStr);
  return { startDate: addDaysToDateString(thisWeekStart, -7), endDateExclusive: thisWeekStart };
}

/** The current Sun-Sat week, truncated to today inclusive -- the ruled "This week so far" toggle. */
export function getThisWeekSoFar(todayStr: string): WeekRange {
  return { startDate: getWeekStartDate(todayStr), endDateExclusive: addDaysToDateString(todayStr, 1) };
}
