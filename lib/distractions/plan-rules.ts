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

/** True once local time is past REVIEW_AVAILABLE_HOUR. Pure — takes `now` and tz. */
export function isReviewOpen(now: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now)
  );
  return hour >= REVIEW_AVAILABLE_HOUR;
}
