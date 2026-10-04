import { effectiveDayString, localDateString, resolveLocalTime } from "@/lib/date-utils";

/**
 * Which card Home's day-rhythm section shows (IA-P2). One pure function so the card, the evening
 * close and the tests agree on "which day, which phase":
 *   done       the day being closed is closed (and it is evening/night), nothing left to do tonight
 *   wind_down  from the wind-down time (default 21:00 local) -- or in the 00:00-04:00 tail when the
 *              day that just ended was never closed and Start Day wasn't tapped for the new one --
 *              "Close the day"
 *   today      Start Day was tapped: the Today strip
 *   morning    otherwise: last night's three + Start Day
 * THE CLOSED DAY is effectiveDayString (the 4 AM rollover), the SAME function the close's write path
 * (evening_closes date, planningDateForCore) and the close page use, so card and close always agree.
 * Start Day and "today" stay on plain local today.
 */
export type RhythmState = "morning" | "today" | "wind_down" | "done";

export const DEFAULT_WIND_DOWN = "21:00";

export function homeRhythmState(input: {
  now: Date;
  timezone: string;
  /** day_starts row exists for local TODAY. */
  dayStarted: boolean;
  /** evening_closes row exists for effectiveDayString(now). */
  closedEffectiveDay: boolean;
  windDownStart?: string;
}): RhythmState {
  const { now, timezone, dayStarted, closedEffectiveDay, windDownStart = DEFAULT_WIND_DOWN } = input;
  const localToday = localDateString(now, timezone);
  const inNightTail = effectiveDayString(now, timezone) !== localToday; // 00:00-04:00: yesterday is still "the day"
  const afterWindDown = inNightTail || now.getTime() >= resolveLocalTime(localToday, windDownStart, timezone).getTime();

  if (afterWindDown && closedEffectiveDay) return "done";
  if (afterWindDown && !(inNightTail && dayStarted)) return "wind_down";
  return dayStarted ? "today" : "morning";
}
