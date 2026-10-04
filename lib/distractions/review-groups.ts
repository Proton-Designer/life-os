import type { DistractionDomain, ReviewItem, TriggerSummary } from "./types";

// Review order, per spec §5 — domains with zero events today are skipped
// entirely rather than rendered empty.
export const REVIEW_DOMAIN_ORDER: DistractionDomain[] = ["deen", "business", "school", "fitness", "co_op"];

export type ReviewGroup = { domain: DistractionDomain; items: ReviewItem[] };

/**
 * Today's distraction-plan review, grouped by domain: every trigger with at least one event on
 * `triggers`' date (todayCount > 0), `isNew` when it has no plan yet. Pure, so the evening
 * close, Home's plan dialog and the query layer all derive the SAME list (IA-P1b: one review).
 */
export function buildReviewGroups(triggers: readonly TriggerSummary[]): ReviewGroup[] {
  const today = triggers.filter((t) => t.todayCount > 0);
  const groups: ReviewGroup[] = [];
  for (const domain of REVIEW_DOMAIN_ORDER) {
    const items = today
      .filter((t) => t.domain === domain)
      .map((trigger) => ({ trigger, todayCount: trigger.todayCount, isNew: trigger.currentPlan === null }));
    if (items.length > 0) groups.push({ domain, items });
  }
  return groups;
}
