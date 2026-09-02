import type { PriorityItem } from "./types";
import { buildCandidatesFromPriorityItems, type AreaWeightLookup } from "./build-candidates";
import { rankCandidates } from "./arbiter";

/**
 * One item per domain -- the most urgent pending item in each -- ordered
 * by the real cross-domain arbiter (urgency -> dueAt -> weight tier ->
 * position -> decay -> cost -> riskScore). Replaces the old
 * NEXT_ACTION_ORDER-tie-broken version (A2 wiring, R18(3)'s full ruling:
 * "weight tier, then position" as the tie-break once real weight data
 * exists -- resolveAreaWeights, migration 110, is now on production, so
 * there is no reason left to fall back to a hardcoded domain array).
 *
 * `weights` comes from resolveAreaWeights(domainsState) -- an area with
 * no resolved entry (today: Business, co_op) falls to the arbiter's own
 * "important" floor, never a guessed tier; see build-candidates.ts's own
 * AreaWeightLookup comment for why that gap is real and named, not an
 * oversight.
 */
export function selectNextActionPerDomain(items: PriorityItem[], weights: AreaWeightLookup, now: Date): PriorityItem[] {
  const byDomain = new Map<string, PriorityItem>();
  // "Most urgent item within a domain wins" -- items arrives already
  // sorted by urgency (getPriorityItems' own sort), so the FIRST match
  // per domain is the most urgent one. Same selection semantics the old
  // `.find()`-based version had; only the CROSS-domain ordering below
  // changed.
  for (const item of items) {
    if (!byDomain.has(item.domain)) byDomain.set(item.domain, item);
  }
  const picked = [...byDomain.values()];
  if (picked.length === 0) return [];

  const candidates = buildCandidatesFromPriorityItems(picked, weights);
  const ranked = rankCandidates(candidates, now);
  const itemById = new Map(picked.map((item) => [item.id, item]));
  return ranked.map((c) => itemById.get(c.id)!);
}
