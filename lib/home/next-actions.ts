import type { PriorityItem, Domain } from "./types";

/** Fixed display order, per Ayman's enumeration: deen, kill list, fitness, school, co-op. */
export const NEXT_ACTION_ORDER: Domain[] = ["deen", "business", "fitness", "school", "co_op"];

/**
 * One item per domain — the most urgent pending item in each — in a stable
 * domain order. Domains with nothing pending are omitted entirely ("if and
 * whenever those are applicable").
 */
export function selectNextActionPerDomain(items: PriorityItem[]): PriorityItem[] {
  const result: PriorityItem[] = [];
  for (const domain of NEXT_ACTION_ORDER) {
    const match = items.find((item) => item.domain === domain);
    if (match) result.push(match);
  }
  return result;
}
