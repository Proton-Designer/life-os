/**
 * HOME-02: which layout Home's "today" phase uses. ONE switch, one line to revert:
 *   "bar"     -> the Day bar: Awake for / Focus / Efficiency merged into one timeline card with the day's
 *               blocks (lib/home/day-bar.ts, components/home/day-bar.tsx); the separate "The day's shape"
 *               panel renders nothing.
 *   "classic" -> exactly the layout before HOME-02 (bfb6879): three StatTiles in the rhythm card plus the
 *               separate "The day's shape" panel at the bottom. Neither is deleted; the classic code paths
 *               are untouched.
 * Reverting = change this constant to "classic" and deploy.
 */
export type HomeDayView = "bar" | "classic";

export const HOME_DAY_VIEW: HomeDayView = "bar";
