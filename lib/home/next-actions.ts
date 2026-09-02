import type { PriorityItem, Domain } from "./types";

/** Fixed display order, per Ayman's enumeration: deen, kill list, fitness, school, co-op. */
export const NEXT_ACTION_ORDER: Domain[] = ["deen", "business", "fitness", "school", "co_op"];

const NEXT_ACTION_ORDER_INDEX: Record<Domain, number> = Object.fromEntries(
  NEXT_ACTION_ORDER.map((domain, i) => [domain, i])
) as Record<Domain, number>;

/**
 * One item per domain — the most urgent pending item in each — ordered by
 * urgency across domains (right_now before later_today, earlier dueAt
 * first), not by a fixed domain order. A School deadline due in 20 minutes
 * must outrank a Business kill-list item with no due time; NEXT_ACTION_ORDER
 * alone can't express that, since it's a static domain ranking, not an
 * urgency one. (Fitness is a separate case: next-actions.tsx renders it in
 * its own row below the shared list regardless of this function's output
 * order, so the ordering guarantee here matters most for the domains that
 * actually share a render — Deen/Business/School/co_op. This function has
 * one caller, next-actions.tsx; lib/notifications/get-notifications.ts
 * reads getPriorityItems directly and sorts its own feed by dueAt alone, so
 * it's unaffected by anything here.)
 *
 * NEXT_ACTION_ORDER is still load-bearing here, as the tie-break: when two
 * domains' items land in the same urgency bucket with the same (or absent)
 * dueAt, mirroring getPriorityItems' own tie-break keeps Home from
 * reshuffling those ties on every render, which was the reason the fixed
 * order existed in the first place ("if and whenever those are
 * applicable"). Domains with nothing pending are omitted entirely.
 */
export function selectNextActionPerDomain(items: PriorityItem[]): PriorityItem[] {
  const picked: PriorityItem[] = [];
  for (const domain of NEXT_ACTION_ORDER) {
    const match = items.find((item) => item.domain === domain);
    if (match) picked.push(match);
  }

  return picked.sort((a, b) => {
    if (a.urgencyBucket !== b.urgencyBucket) {
      return a.urgencyBucket === "right_now" ? -1 : 1;
    }
    const aTime = a.dueAt?.getTime() ?? Infinity;
    const bTime = b.dueAt?.getTime() ?? Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return NEXT_ACTION_ORDER_INDEX[a.domain] - NEXT_ACTION_ORDER_INDEX[b.domain];
  });
}
