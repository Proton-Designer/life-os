import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import type { TriggerSummary } from "./types";

export const REVIEW_AVAILABLE_HOUR = 21; // 9 PM local
export const FORCED_REWRITE_AFTER_SKIPS = 3;

/** A plan that has ever been followed is never force-rewritten. */
export function mustRewrite(followedCount: number, skippedCount: number): boolean {
  return skippedCount >= FORCED_REWRITE_AFTER_SKIPS && followedCount === 0;
}

function compareByLastOccurredDesc(a: TriggerSummary, b: TriggerSummary): number {
  const aTime = a.lastOccurredAtIso ? new Date(a.lastOccurredAtIso).getTime() : 0;
  const bTime = b.lastOccurredAtIso ? new Date(b.lastOccurredAtIso).getTime() : 0;
  return bTime - aTime;
}

/** Capture-list order: totalCount desc, then lastOccurredAt desc, then name asc. */
export function rankTriggersForCapture(triggers: TriggerSummary[]): TriggerSummary[] {
  return [...triggers].sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    const byLast = compareByLastOccurredDesc(a, b);
    if (byLast !== 0) return byLast;
    return a.name.localeCompare(b.name);
  });
}

/** Action-Plan-dialog order: lastOccurredAt desc. Excludes currentPlan === null. */
export function rankTriggersForPlanList(triggers: TriggerSummary[]): TriggerSummary[] {
  return triggers.filter((t) => t.currentPlan !== null).sort(compareByLastOccurredDesc);
}

function localHour(now: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now)
  );
}

/**
 * The review's day boundary is NOT plain midnight (the Lead, 2026-08-24):
 * "after 9 PM" taken literally breaks the moment he opens it after
 * midnight — a realistic hour — silently rolling over to a new, empty day
 * and making yesterday's triggers permanently unreviewable. So the review
 * stays open through a 4 AM tail, and both isReviewOpen and reviewDateFor
 * share that same window. Distraction CAPTURE is unaffected — it keeps the
 * ordinary midnight boundary via localDateString, same as every other
 * per-day number in the app; only the review screen gets this extension.
 */
const REVIEW_TAIL_END_HOUR = 4;

/** True from REVIEW_AVAILABLE_HOUR through REVIEW_TAIL_END_HOUR the following morning. Pure — takes `now` and tz. */
export function isReviewOpen(now: Date, timezone: string): boolean {
  const hour = localHour(now, timezone);
  return hour >= REVIEW_AVAILABLE_HOUR || hour < REVIEW_TAIL_END_HOUR;
}

/** The local date the review screen targets — yesterday during the post-midnight tail, otherwise today. */
export function reviewDateFor(now: Date, timezone: string): string {
  const hour = localHour(now, timezone);
  const today = localDateString(now, timezone);
  return hour < REVIEW_TAIL_END_HOUR ? addDaysToDateString(today, -1) : today;
}
