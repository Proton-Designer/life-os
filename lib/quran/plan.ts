import { addDaysToDateString } from "@/lib/date-utils";
import { JUZ_START_PAGES, TOTAL_PAGES } from "@/lib/quran/page-map";

/**
 * QURAN-01: the khatm plan's PURE maths (no I/O, no clock: every function takes the user's LOCAL date string, resolved
 * by the caller with localDateString/resolveLocalTime). Dates are YYYY-MM-DD and move only through
 * addDaysToDateString; differences are whole calendar days via UTC date arithmetic (no timezone / DST drift).
 *
 * MODEL. current_page is the NEXT page to read (605 = finished). The plan is (re)based at planSetOn / planSetPage: from
 * that day the remaining pages are spread evenly over the planned days at `pace` pages/day. The cumulative target at the
 * END of a day is round(pace x active days elapsed), so a day's portion is "pages up to that target, minus where the
 * bookmark is" and the rounding always lands exactly on the finish day (the last planned day's target is every page).
 * Paused days are frozen: they do not advance the target, and the finish date shifts out by the frozen days.
 */

export const FINISH_PAGE = TOTAL_PAGES + 1; // current_page value meaning "finished"
export const MIN_PACE = 0.25;
export const MAX_PLAN_DAYS = 3650;
export const MOVE_DATE_FACTOR = 2; // suggest moving the date when the needed pace exceeds this x the original pace
export const RECENT_WINDOW_DAYS = 14;
export const MIN_RECENT_DATA_POINTS = 3;

/** Pages that show the khatm plan (the Deen card, Home Now/sector row, evening close, weekly reset, Insights): revalidated after any write. */
export const QURAN_VIEW_PATHS = ["/deen", "/", "/close", "/week", "/insights"] as const;

export type QuranPlanStatus = "active" | "paused" | "completed";

export type QuranPlanParams = {
  startDate: string;
  startPage: number;
  /** The baseline day/page the remaining pages are spread from (reset by Keep/Move date). */
  planSetOn: string;
  planSetPage: number;
  targetDate: string | null;
  pacePagesPerDay: number | null;
  /** The pace when the plan was first created; never changes. */
  originalPacePagesPerDay: number;
  /** The NEXT page to read (605 = finished). */
  currentPage: number;
  status: QuranPlanStatus;
  /** First frozen local day while paused. */
  pausedOn: string | null;
  /** Frozen days from earlier pauses since the baseline. */
  pausedDays: number;
};

/** Whole calendar days from `from` to `to` (to - from). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export const isFinished = (currentPage: number) => currentPage > TOTAL_PAGES;

/** Pages left to read from the bookmark. */
export const pagesLeft = (currentPage: number) => Math.max(0, FINISH_PAGE - currentPage);

/** Pages in the plan counted from its baseline. */
export function planPages(plan: Pick<QuranPlanParams, "planSetPage">): number {
  return Math.max(1, FINISH_PAGE - plan.planSetPage);
}

/** Planned reading days from the baseline (inclusive of the finish day). */
export function planDays(plan: Pick<QuranPlanParams, "planSetOn" | "planSetPage" | "targetDate" | "pacePagesPerDay">): number {
  if (plan.targetDate) return Math.max(1, daysBetween(plan.planSetOn, plan.targetDate) + 1);
  return Math.max(1, Math.ceil(planPages(plan) / (plan.pacePagesPerDay ?? MIN_PACE)));
}

/** Pages per day the plan asks for. */
export function planPace(plan: Pick<QuranPlanParams, "planSetOn" | "planSetPage" | "targetDate" | "pacePagesPerDay">): number {
  return plan.targetDate ? planPages(plan) / planDays(plan) : (plan.pacePagesPerDay ?? MIN_PACE);
}

/** The finish day before pauses (the stored target, or baseline + ceil(pages / pace) - 1). */
export function baseTargetDate(plan: Pick<QuranPlanParams, "planSetOn" | "planSetPage" | "targetDate" | "pacePagesPerDay">): string {
  return plan.targetDate ?? addDaysToDateString(plan.planSetOn, planDays(plan) - 1);
}

/** Active (non-frozen) planned days elapsed up to and including `localDate`, capped at the plan length. */
export function activeDaysThrough(plan: QuranPlanParams, localDate: string): number {
  const end = plan.pausedOn && localDate >= plan.pausedOn ? addDaysToDateString(plan.pausedOn, -1) : localDate;
  const elapsed = daysBetween(plan.planSetOn, end) + 1 - plan.pausedDays;
  return Math.max(0, Math.min(planDays(plan), elapsed));
}

/** The finish day including every frozen day so far (an open pause counts its days up to `localDate`). */
export function effectiveTargetDate(plan: QuranPlanParams, localDate: string): string {
  const openPause = plan.pausedOn && localDate >= plan.pausedOn ? daysBetween(plan.pausedOn, localDate) + 1 : 0;
  return addDaysToDateString(baseTargetDate(plan), plan.pausedDays + openPause);
}

/** Pages that should be read since the baseline by the END of `localDate`. */
export function cumulativeTargetPages(plan: QuranPlanParams, localDate: string): number {
  const days = activeDaysThrough(plan, localDate);
  if (days >= planDays(plan)) return planPages(plan); // the finish day lands exactly on the last page
  return Math.min(planPages(plan), Math.round(planPace(plan) * days));
}

/** The next page that should be on the bookmark at the END of `localDate`. */
export function expectedNextPage(plan: QuranPlanParams, localDate: string): number {
  return Math.min(FINISH_PAGE, plan.planSetPage + cumulativeTargetPages(plan, localDate));
}

export type Portion = { from: number; to: number; pages: number; /** The bookmark is already at/after today's target. */ done: boolean };

/**
 * Today's portion: from the bookmark to today's target (catch-up is built in), at least one page while unfinished.
 * null when finished or paused. `done` = today's target is already met (the UI shows it as done, not as "1 more page").
 */
export function todaysPortion(plan: QuranPlanParams, localDate: string): Portion | null {
  if (plan.status !== "active" || isFinished(plan.currentPage)) return null;
  const target = expectedNextPage(plan, localDate) - 1; // last page due by the end of today
  const from = plan.currentPage;
  const to = Math.min(TOTAL_PAGES, Math.max(from, target));
  return { from, to, pages: to - from + 1, done: plan.currentPage > target };
}

export type RecentPace = { pagesPerDay: number; dataPoints: number; /** True when there was too little data and the plan pace is used. */ usedPlanPace: boolean };

/**
 * Average pages/day over the last RECENT_WINDOW_DAYS (or since `sinceDate` if the plan is younger), from the days with a
 * log. Fewer than MIN_RECENT_DATA_POINTS distinct reading days falls back to the plan pace.
 */
export function recentPace(sessions: ReadonlyArray<{ date: string; pages: number }>, localDate: string, sinceDate: string, planPaceFallback: number): RecentPace {
  const windowDays = Math.max(1, Math.min(RECENT_WINDOW_DAYS, daysBetween(sinceDate, localDate) + 1));
  const windowStart = addDaysToDateString(localDate, -(windowDays - 1));
  const inWindow = sessions.filter((s) => s.date >= windowStart && s.date <= localDate && s.pages > 0);
  const days = new Set(inWindow.map((s) => s.date));
  if (days.size < MIN_RECENT_DATA_POINTS) return { pagesPerDay: planPaceFallback, dataPoints: days.size, usedPlanPace: true };
  return { pagesPerDay: inWindow.reduce((n, s) => n + s.pages, 0) / windowDays, dataPoints: days.size, usedPlanPace: false };
}

/** "5 of the last 7 days": distinct days with a log in the 7 days ending `localDate` (no streaks). */
export function readingDaysInLast7(sessions: ReadonlyArray<{ date: string; pages: number }>, localDate: string): number {
  const start = addDaysToDateString(localDate, -6);
  return new Set(sessions.filter((s) => s.date >= start && s.date <= localDate && s.pages > 0).map((s) => s.date)).size;
}

export type PlanStatusKind = "on_track" | "behind" | "ahead" | "paused" | "completed";

export type PlanStatus = {
  kind: PlanStatusKind;
  /** behind: pages behind (before today's portion); ahead: pages beyond today's target; else 0. */
  pages: number;
  /** behind: about how many days of reading that is. */
  days: number;
  pagesLeft: number;
  /** Active planned days left, including today (>= 1 while unfinished). */
  daysLeft: number;
  /** Pages/day needed from today to still finish on the (effective) target date. */
  neededPerDay: number;
  planPace: number;
  effectiveTargetDate: string;
  /** Finish day at the recent pace (or the plan pace when there is too little data); null when paused/finished. */
  projectedFinish: string | null;
  recent: RecentPace;
  /** True when finishing on the target date now needs more than MOVE_DATE_FACTOR x the original pace: suggest moving the date first. */
  suggestMoveDate: boolean;
  /** The date to offer when suggestMoveDate (the projected finish at the recent pace). */
  suggestedDate: string | null;
};

export function planStatus(plan: QuranPlanParams, localDate: string, recent: RecentPace): PlanStatus {
  const pace = planPace(plan);
  const target = effectiveTargetDate(plan, localDate);
  const left = pagesLeft(plan.currentPage);
  const base = { pagesLeft: left, planPace: pace, effectiveTargetDate: target, recent };
  if (plan.status === "completed" || isFinished(plan.currentPage)) {
    return { ...base, kind: "completed", pages: 0, days: 0, daysLeft: 0, neededPerDay: 0, projectedFinish: null, suggestMoveDate: false, suggestedDate: null };
  }
  const yesterday = addDaysToDateString(localDate, -1);
  const daysLeft = Math.max(1, planDays(plan) - activeDaysThrough(plan, yesterday));
  const neededPerDay = left / daysLeft;
  if (plan.status === "paused") {
    return { ...base, kind: "paused", pages: 0, days: 0, daysLeft, neededPerDay, projectedFinish: null, suggestMoveDate: false, suggestedDate: null };
  }

  const expectedToday = expectedNextPage(plan, localDate);
  const expectedYesterday = expectedNextPage(plan, yesterday);
  let kind: PlanStatusKind = "on_track";
  let pages = 0;
  let days = 0;
  if (plan.currentPage >= expectedToday) {
    pages = plan.currentPage - expectedToday;
    kind = pages > 0 ? "ahead" : "on_track";
  } else if (expectedYesterday - plan.currentPage > 0) {
    pages = expectedYesterday - plan.currentPage;
    days = Math.max(1, Math.ceil(pages / pace));
    kind = "behind";
  }

  const rate = Math.max(MIN_PACE, recent.pagesPerDay);
  const projectedFinish = addDaysToDateString(localDate, Math.max(0, Math.ceil(left / rate) - 1));
  const suggestMoveDate = neededPerDay > MOVE_DATE_FACTOR * plan.originalPacePagesPerDay && projectedFinish > target;
  return { ...base, kind, pages, days, daysLeft, neededPerDay, projectedFinish, suggestMoveDate, suggestedDate: suggestMoveDate ? projectedFinish : null };
}

// ----------------------------------------------------------------------------------------------------------------
// Setup presets

export type QuranPlanPreset =
  | { kind: "days"; days: 30 | 60 }
  | { kind: "six_months" }
  | { kind: "ramadan"; ramadanEnd?: string | null }
  | { kind: "custom_date"; targetDate: string }
  | { kind: "custom_pace"; pagesPerDay: number };

export type PlanSetup = { targetDate: string | null; pacePagesPerDay: number | null; originalPacePagesPerDay: number; label: string };

/** The default offered in setup. */
export const DEFAULT_PRESET: QuranPlanPreset = { kind: "days", days: 60 };

/** Plan parameters for a preset, started on `startDate` at `startPage` (1 or the current page). Returns { error } for invalid input. */
export function planSetupFor(preset: QuranPlanPreset, startDate: string, startPage: number): PlanSetup | { error: string } {
  if (!Number.isInteger(startPage) || startPage < 1 || startPage > TOTAL_PAGES) return { error: `Start page must be between 1 and ${TOTAL_PAGES}.` };
  const pages = FINISH_PAGE - startPage;
  const byDate = (targetDate: string, label: string): PlanSetup | { error: string } => {
    const days = daysBetween(startDate, targetDate) + 1;
    if (days < 1) return { error: "Pick a finish date that is today or later." };
    if (days > MAX_PLAN_DAYS) return { error: "Pick a finish date within 10 years." };
    return { targetDate, pacePagesPerDay: null, originalPacePagesPerDay: round2(pages / days), label };
  };
  switch (preset.kind) {
    case "days":
      return byDate(addDaysToDateString(startDate, preset.days - 1), `Finish in ${preset.days} days`);
    case "six_months":
      return byDate(addDaysToDateString(startDate, 182), "Finish in 6 months");
    case "ramadan": {
      const end = preset.ramadanEnd && preset.ramadanEnd >= startDate ? preset.ramadanEnd : addDaysToDateString(startDate, 29);
      return byDate(end, "One juz a day (Ramadan)");
    }
    case "custom_date":
      return byDate(preset.targetDate, "Custom finish date");
    case "custom_pace": {
      const p = preset.pagesPerDay;
      if (!Number.isFinite(p) || p < MIN_PACE || p > TOTAL_PAGES) return { error: `Pages per day must be between ${MIN_PACE} and ${TOTAL_PAGES}.` };
      if (Math.ceil(pages / p) > MAX_PLAN_DAYS) return { error: "That pace would take more than 10 years." };
      return { targetDate: null, pacePagesPerDay: round2(p), originalPacePagesPerDay: round2(p), label: "Custom pace" };
    }
  }
}

export function isPlanSetupError(x: PlanSetup | { error: string }): x is { error: string } {
  return "error" in x;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ----------------------------------------------------------------------------------------------------------------
// Logging + milestones

/** The page after which juz `j` (1..30) is complete. */
export function juzEndPage(j: number): number {
  return j >= 30 ? TOTAL_PAGES : JUZ_START_PAGES[j] - 1;
}

/** Juz completed by moving the bookmark from `prevCurrent` to `newCurrent` (each is "next page to read"). */
export function juzCompletedBetween(prevCurrent: number, newCurrent: number): number[] {
  const out: number[] = [];
  for (let j = 1; j <= 30; j++) {
    const end = juzEndPage(j);
    if (prevCurrent <= end && newCurrent > end) out.push(j);
  }
  return out;
}

export type ReadingLog = { newCurrentPage: number; pagesRead: number; fromPage: number; toPage: number; juzCompleted: number[]; khatmComplete: boolean };

/**
 * Logging reading that ends at `toPage` (the last page read). The bookmark only moves FORWARD this way (going back is the
 * explicit "edit bookmark" action). Returns { error } for a page outside 1..604 or one that adds nothing.
 */
export function applyReading(currentPage: number, toPage: number): ReadingLog | { error: string } {
  if (!Number.isInteger(toPage) || toPage < 1 || toPage > TOTAL_PAGES) return { error: `Page must be between 1 and ${TOTAL_PAGES}.` };
  if (isFinished(currentPage)) return { error: "This khatm is already complete." };
  if (toPage < currentPage) return { error: `You're already past page ${toPage}. Use "Edit bookmark" to move back.` };
  const newCurrentPage = toPage + 1;
  return {
    newCurrentPage,
    pagesRead: newCurrentPage - currentPage,
    fromPage: currentPage,
    toPage,
    juzCompleted: juzCompletedBetween(currentPage, newCurrentPage),
    khatmComplete: newCurrentPage > TOTAL_PAGES,
  };
}

/** "Juz 7 complete · 7 of 30". */
export function juzMilestoneLabel(juz: number): string {
  return `Juz ${juz} complete · ${juz} of 30`;
}

/** Percent of the khatm read, 0..100 (whole number). */
export function khatmPercent(currentPage: number): number {
  return Math.min(100, Math.floor(((currentPage - 1) / TOTAL_PAGES) * 100));
}

// ----------------------------------------------------------------------------------------------------------------
// Re-baselining + pausing (return the new plan fields; the action persists them)

export type PlanBaseline = { planSetOn: string; planSetPage: number; targetDate: string | null; pacePagesPerDay: number | null; pausedDays: number };

/** "Keep the date": the SAME effective finish day, remaining pages re-spread from today. */
export function keepDateBaseline(plan: QuranPlanParams, localDate: string): PlanBaseline | { error: string } {
  const target = effectiveTargetDate(plan, localDate);
  if (target < localDate) return { error: "The finish date has passed. Move the date instead." };
  return { planSetOn: localDate, planSetPage: Math.min(TOTAL_PAGES, plan.currentPage), targetDate: target, pacePagesPerDay: null, pausedDays: 0 };
}

/** "Move the date": a new finish day (today or later), remaining pages re-spread from today. */
export function moveDateBaseline(plan: QuranPlanParams, localDate: string, newDate: string): PlanBaseline | { error: string } {
  if (newDate < localDate) return { error: "Pick a finish date that is today or later." };
  if (daysBetween(localDate, newDate) + 1 > MAX_PLAN_DAYS) return { error: "Pick a finish date within 10 years." };
  return { planSetOn: localDate, planSetPage: Math.min(TOTAL_PAGES, plan.currentPage), targetDate: newDate, pacePagesPerDay: null, pausedDays: 0 };
}

/** Days frozen by a pause that ran from `pausedOn` up to (not including) `resumeDate`. */
export function pausedSpanDays(pausedOn: string, resumeDate: string): number {
  return Math.max(0, daysBetween(pausedOn, resumeDate));
}
