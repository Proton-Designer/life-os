// Mirrors ULM's `getRetrievability` (packages/core/src/fsrs/index.ts) — NOT
// `book_memory_strength`'s SQL, which hardcodes FSRS-5 forgetting-curve
// constants (F=19/81, D=-0.5) while the scheduler actually running is
// FSRS-6. The ULM lead measured up to a 12.5-point disagreement between the
// two on an overdue card, worst exactly where a "retention is slipping" bar
// most needs to be right. Delegating to ts-fsrs's own `get_retrievability`
// means this can never drift from whichever FSRS version the scheduler
// actually uses — the same reason ULM's own TS mirror does this instead of
// hand-copying constants a second time.
//
// The untouched-card-counts-as-zero rule (never excluded from the
// denominator) is independent of the curve and preserved exactly as
// specified — a lesson/book with a mix of reviewed and never-touched cards
// must never read stronger than the arithmetic implies.
import { State } from "ts-fsrs";
import { getScheduler, toFsrsCard, type DbCardState, type DbFsrsState } from "./fsrs-scheduler";

// Re-exported under this module's established name — session code and any
// other caller importing from here keeps working; the canonical definition
// now lives in fsrs-scheduler.ts (D-037-shaped consolidation: "there must be
// exactly one scheduler in this codebase" applies to the DB<->ts-frs state
// mapping too, not just the FSRS config itself).
export type FsrsState = DbFsrsState;
export type CardStateForStrength = DbCardState;

/**
 * A card with no `card_states` row at all (never reviewed) is passed as
 * `null` — same "counts as zero" semantics as a `state: "new"` row.
 */
export function cardRetrievability(cardState: CardStateForStrength | null, now: Date): number {
  const card = toFsrsCard(cardState, now);
  if (card.state === State.New) return 0;
  // stability <= 0 / missing last_review shouldn't be reachable for a
  // non-new card — submit_review rejects stability <= 0 and
  // card_states_derive_and_check guards the row's shape (ULM lead). If this
  // ever fires, something upstream is broken; warn rather than silently
  // absorbing it, so the fallback is a safety net that reports, not one
  // that hides the actual bug behind a plausible-looking 0.
  if (card.stability <= 0 || !card.last_review) {
    console.warn("[self-mastery] cardRetrievability: non-new card with invalid stability/last_review", {
      state: cardState?.state,
      stability: card.stability,
      hasLastReview: Boolean(card.last_review),
    });
    return 0;
  }
  return getScheduler().get_retrievability(card, now, false);
}

/**
 * `cardStates` must have exactly one entry per card the aggregate is over
 * (a lesson's cards, or a book's cards) — pass `null` for a card with no
 * `card_states` row, never omit it. Omitting untouched cards from this
 * array is the exact bug the ULM lead flagged: it would count them as
 * excluded rather than as zero, letting a half-reviewed set read as 100%.
 */
export function averageRetrievability(cardStates: (CardStateForStrength | null)[], now: Date): number {
  if (cardStates.length === 0) return 0;
  const sum = cardStates.reduce((acc, cs) => acc + cardRetrievability(cs, now), 0);
  return sum / cardStates.length;
}
