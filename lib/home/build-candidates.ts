// Converts real data shapes (PriorityItem[] from getPriorityItems, a
// Self-Mastery due-session summary) into the arbiter's generic Candidate
// shape (lib/home/arbiter.ts). Pure functions, no DB access -- the live
// queries that produce their inputs (getUserDomains selecting `weight`,
// a new query for Self-Mastery's earliest-due-card `due_at` and lowest
// retrievability) are the next increment, not built here.
import type { PriorityItem } from "./types";
import type { Area, Candidate, WeightTier } from "./arbiter";

export interface AreaWeight {
  weightTier: WeightTier | null;
  position: number | null;
}

/**
 * Weight/position lookup, keyed by Area. Deliberately a PARTIAL record --
 * not every Area has a resolved entry today.
 *
 * `user_domains.weight` (migration 110) is scoped to the THREE top-level
 * onboarding domains (personal_growth/work/school), not the five-plus
 * legacy Domain/Area values the arbiter ranks. Deen/Fitness/Self-Mastery
 * map 1:1 to Personal Growth's own fixed subdomains and School maps 1:1
 * to the "school" top-level domain (components/onboarding/domain-meta.ts,
 * confirmed in source) -- callers can resolve real entries for those four
 * areas. Business (kill list) and co_op have NO counterpart in the new
 * vocabulary at all: co_op is documented elsewhere as "a fixed
 * domain='co_op' concept... unrelated table" (app/(app)/work/subdomain-
 * actions.ts), separate from the new user-created Work subdomains model,
 * and kill-list "business" has no subdomain of its own either. This is a
 * real, named gap (flagged to the LifeOS lead, 2026-09-02 -- escalated
 * for a product decision on what Business/co_op's weight identity even
 * is), not an oversight papered over with an invented mapping.
 *
 * An area with no entry here gets `weightTier: null, position: null` from
 * the builders below -- the arbiter's own `?? "important"` floor, the
 * same safe default the database backfill itself uses, never a guessed
 * tier.
 */
export type AreaWeightLookup = Partial<Record<Area, AreaWeight>>;

/**
 * Maps every real PriorityItem (the five-domain Home "Now" system) into
 * an arbiter Candidate. `decay` is always null here -- R18(2): no domain
 * reachable through PriorityItem has a decay source today (that's
 * Self-Mastery-only, and Self-Mastery isn't a PriorityItem source at all;
 * see buildSelfMasteryCandidate below). `cost` passes through whatever
 * getPriorityItems already computed (real for Fitness's scheduled
 * sessions, null everywhere else -- see PriorityItem.cost's own comment).
 */
export function buildCandidatesFromPriorityItems(items: PriorityItem[], weights: AreaWeightLookup): Candidate[] {
  return items.map((item) => {
    const w = weights[item.domain];
    return {
      id: item.id,
      area: item.domain,
      title: item.title,
      dueAt: item.dueAt,
      weightTier: w?.weightTier ?? null,
      position: w?.position ?? null,
      decay: null,
      cost: item.cost,
    };
  });
}

export interface SelfMasterySummary {
  /** The earliest due card's `due_at` (R19: "a real deadline, so it competes in the same lexicographic frame as dated items rather than always losing"). Null when nothing is due. */
  dueAt: Date | null;
  /** Lowest retrievability among due cards (R19). Null when there's nothing due to compute it from. */
  decay: number | null;
  /** The session's own time estimate (queue-limits.ts). Null when there's no session to estimate. */
  cost: number | null;
  /**
   * Whether Self-Mastery has a real candidate to offer at all -- kept
   * separate from the individual fields above rather than inferred from
   * them (e.g. "dueAt === null means no candidate" would be wrong: a
   * fresh, never-touched deck has real NEW cards and a real cost/decay,
   * but no due_at yet, since nothing has a scheduled due date). Mirrors
   * getDueSummary's own dueCount/newCount/starterDeckMissing distinction.
   */
  hasCandidate: boolean;
}

/**
 * R19: Self-Mastery's due session as an arbiter candidate. Returns `null`
 * -- no candidate -- rather than a zero-scored placeholder when there's
 * genuinely nothing to offer (R1: emit no candidate at insufficient
 * confidence, never one with every field defaulted).
 */
export function buildSelfMasteryCandidate(summary: SelfMasterySummary, weights: AreaWeightLookup): Candidate | null {
  if (!summary.hasCandidate) return null;
  const w = weights.self_mastery;
  return {
    id: "self-mastery-session",
    area: "self_mastery",
    title: "Self-Mastery",
    dueAt: summary.dueAt,
    weightTier: w?.weightTier ?? null,
    position: w?.position ?? null,
    decay: summary.decay,
    cost: summary.cost,
  };
}
