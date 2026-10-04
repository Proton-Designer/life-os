import { isWeeklyResetWindow } from "@/lib/week/reset-window";

/**
 * Home's Sunday card (IA-P3b): inside the reset window (local Sunday 00:00 -> Monday 12:00) and until
 * this week's goal has a headline -- saving one in /week step 5 (or the Home header) makes it vanish.
 * `goalHeadlines` are this week's weekly_goals headlines for the domains the account uses.
 */
export function shouldShowWeeklyResetCard(now: Date, timezone: string, goalHeadlines: readonly (string | null | undefined)[]): boolean {
  return isWeeklyResetWindow(now, timezone) && !goalHeadlines.some((h) => (h ?? "").trim() !== "");
}
