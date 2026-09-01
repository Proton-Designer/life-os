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
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type FSRS } from "ts-fsrs";

export type FsrsState = "new" | "learning" | "review" | "relearning";

const DB_TO_TS_STATE: Record<FsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export interface CardStateForStrength {
  state: FsrsState;
  stability: number | null;
  difficulty: number | null;
  dueAt: string | null;
  reps: number;
  lapses: number;
  lastReviewAt: string | null;
}

// enable_fuzz is false by ts-fsrs's own library default — passed literally
// per the same reasoning REFERENCES.md records for ULM's own scheduler
// construction: a future ts-fsrs major can't silently change this out from
// under a read that must stay deterministic for the same inputs.
let schedulerSingleton: FSRS | null = null;
function getScheduler(): FSRS {
  if (!schedulerSingleton) {
    schedulerSingleton = fsrs(generatorParameters({ enable_fuzz: false }));
  }
  return schedulerSingleton;
}

function toFsrsCard(row: CardStateForStrength | null, now: Date): Card {
  if (row === null || row.state === "new") {
    return createEmptyCard(now);
  }
  return {
    due: new Date(row.dueAt ?? now.toISOString()),
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: DB_TO_TS_STATE[row.state],
    last_review: row.lastReviewAt ? new Date(row.lastReviewAt) : undefined,
  };
}

/**
 * A card with no `card_states` row at all (never reviewed) is passed as
 * `null` — same "counts as zero" semantics as a `state: "new"` row.
 */
export function cardRetrievability(cardState: CardStateForStrength | null, now: Date): number {
  const card = toFsrsCard(cardState, now);
  // stability <= 0 is a degenerate/data-anomaly case (shouldn't happen given
  // the schema's own card_states_derive_and_check trigger, but ts-fsrs
  // divides by stability in the forgetting curve — a 0 there produces NaN,
  // which would silently poison every average it's summed into). Same
  // "counts as zero" answer as an untouched card, not a crash.
  if (card.state === State.New || card.stability <= 0 || !card.last_review) return 0;
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
