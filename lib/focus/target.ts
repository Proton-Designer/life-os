import { dayOfWeekFromDateString } from "@/lib/date-utils";

// HOME-01a: the adjustable daily focus target ("N of 4 Hours today"). Pure and client-safe so the
// Settings editor, Home's Today strip and the server loader share one definition of the rules.

export const DEFAULT_FOCUS_TARGET_MINUTES = 240;
export const MIN_FOCUS_TARGET_MINUTES = 30;
export const MAX_FOCUS_TARGET_MINUTES = 720;

/** What user_settings holds: NULL daily = app default; NULL weekend = use the daily target. */
export type FocusTargetSettings = { dailyMinutes: number | null; weekendMinutes: number | null };

export function isValidFocusTargetMinutes(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_FOCUS_TARGET_MINUTES && n <= MAX_FOCUS_TARGET_MINUTES;
}

/** Mirrors migration 256's CHECK (30-720) so the app refuses what the DB would, with a readable message. */
export function validateFocusTargets(input: FocusTargetSettings): string | null {
  for (const [label, v] of [["Daily", input.dailyMinutes], ["Weekend", input.weekendMinutes]] as const) {
    if (v === null) continue;
    if (!isValidFocusTargetMinutes(v)) {
      return `${label} focus target must be a whole number of minutes between ${MIN_FOCUS_TARGET_MINUTES} (0:30) and ${MAX_FOCUS_TARGET_MINUTES} (12:00).`;
    }
  }
  return null;
}

/** Saturday or Sunday of the user's LOCAL date (pass a YYYY-MM-DD already resolved in their timezone). */
export function isWeekendLocalDate(localDate: string): boolean {
  const dow = dayOfWeekFromDateString(localDate);
  return dow === 0 || dow === 6;
}

/** The target in minutes for a local date: weekend override on Sat/Sun, else daily, else the 240 default. */
export function focusTargetMinutes(settings: FocusTargetSettings | null | undefined, localDate: string): number {
  const daily = isValidFocusTargetMinutes(settings?.dailyMinutes) ? settings!.dailyMinutes! : DEFAULT_FOCUS_TARGET_MINUTES;
  if (isWeekendLocalDate(localDate) && isValidFocusTargetMinutes(settings?.weekendMinutes)) return settings!.weekendMinutes!;
  return daily;
}

/** "4", "4.5", "2.25": the target in hours for "N of M" copy, no trailing zeros. */
export function formatTargetHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}
