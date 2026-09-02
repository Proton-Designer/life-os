/**
 * The promotion decision, extracted so it can be unit-tested without a
 * database. The rule: promote iff at least one card survived generation; a
 * denied lesson keeps its pre-promotion status (never touched here — the
 * caller owns the DB write) and is excluded from the dense rank sequence,
 * not just skipped in place, so a denial doesn't leave a gap in the
 * ordering the UI shows.
 */
export interface PromotionCandidate {
  id: string;
  cardCount: number;
}

export interface PromotionDecision {
  id: string;
  rank: number;
}

export interface PromotionResult {
  /** Dense ranks (0..promoted.length-1), in input order, over survivors only. */
  promoted: PromotionDecision[];
  /** Ids denied promotion — left at their pre-promotion status by the caller. */
  denied: string[];
}

export function decidePromotions(candidates: PromotionCandidate[]): PromotionResult {
  const promoted: PromotionDecision[] = [];
  const denied: string[] = [];
  for (const candidate of candidates) {
    if (candidate.cardCount > 0) {
      promoted.push({ id: candidate.id, rank: promoted.length });
    } else {
      denied.push(candidate.id);
    }
  }
  return { promoted, denied };
}
