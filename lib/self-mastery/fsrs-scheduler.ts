// FSRS scheduling seam — ported from ULM's packages/core/src/fsrs/index.ts.
// "There must be exactly one scheduler in this codebase" (ULM's own doc):
// this is that one place. lib/self-mastery/memory-strength.ts (the read-side
// retrievability display) imports its Card conversion from here rather than
// keeping its own copy, and the session write path (lib/self-mastery/session/)
// imports the write-path pieces (toRpcNextState, computeNextState) from here
// too — one scheduler config, one DB<->ts-fsrs state mapping, used by both.
//
// Division of labour with the `submit_review` RPC (supabase/migrations/078,
// 080): this module computes the *proposed* next FSRS state client-side; the
// RPC re-validates the shape of that proposal (reps +1 exactly, stability >
// 0, due_at > now, legal state transition) before writing it. Neither side
// trusts the other blindly.
import {
  createEmptyCard,
  dateDiffInDays,
  fsrs,
  generatorParameters,
  State,
  type Card,
  type FSRS,
  type Grade,
} from "ts-fsrs";
import type { Database } from "@/lib/supabase/database.types";

export type DbFsrsState = Database["public"]["Enums"]["fsrs_state"];

const DB_TO_TS_STATE: Record<DbFsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const TS_TO_DB_STATE: Record<State, DbFsrsState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

// enable_fuzz is false by ts-fsrs's own library default — passed literally
// so a future ts-fsrs major can't silently flip determinism out from under
// a read (memory-strength display) or a replay that must hold forever
// (CollegeOS's design derives from the log rather than storing).
let schedulerSingleton: FSRS | null = null;
export function getScheduler(): FSRS {
  if (!schedulerSingleton) {
    schedulerSingleton = fsrs(generatorParameters({ enable_fuzz: false }));
  }
  return schedulerSingleton;
}

/** Shape of a `card_states` row — deliberately a subset (no card_id/user_id/book_id; this module only cares about scheduling state). */
export interface DbCardState {
  stability: number | null;
  difficulty: number | null;
  dueAt: string | null;
  reps: number;
  lapses: number;
  state: DbFsrsState;
  lastReviewAt: string | null;
}

/** Convert a `card_states` row into a ts-fsrs `Card`. Pass `null` for a card with no row yet (never scheduled) — equivalent to a fresh `createEmptyCard`. */
export function toFsrsCard(row: DbCardState | null, now: Date): Card {
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

/** The shape `submit_review`'s `p_next_state` jsonb argument expects. */
export interface NextStateForRpc {
  reps: number;
  stability: number;
  difficulty: number;
  due_at: string;
  state: DbFsrsState;
}

export function toRpcNextState(card: Card): NextStateForRpc {
  return {
    reps: card.reps,
    stability: card.stability,
    difficulty: card.difficulty,
    due_at: card.due.toISOString(),
    state: TS_TO_DB_STATE[card.state],
  };
}

/** Rating buttons are 1-4 (Again/Hard/Good/Easy) throughout the product. Asserts the boundary rather than silently coercing an out-of-range number. */
export function toGrade(rating: 1 | 2 | 3 | 4): Grade {
  return rating as Grade;
}

/**
 * Compute the next FSRS state for a card given a grade. The single call site
 * that should ever decide "what happens when the user rates this card" —
 * session UIs call this, build `toRpcNextState(result.card)`, and pass it to
 * `submit_review`.
 */
export function computeNextState(
  scheduler: FSRS,
  current: Card,
  rating: 1 | 2 | 3 | 4,
  now: Date
): { card: Card; scheduledDays: number } {
  const { card } = scheduler.next(current, now, toGrade(rating));
  // Not `log.scheduled_days` — empirically 0 on ts-fsrs 5.4.1 regardless of
  // the actual resulting due date. The due date itself is reliable; derive
  // the day count from that instead.
  return { card, scheduledDays: dateDiffInDays(now, card.due) };
}

/** Retrievability (0-1) for a single card. `null` state.New reads as 0 — never fabricated. */
export function getRetrievability(scheduler: FSRS, card: Card, now: Date): number {
  if (card.state === State.New) return 0;
  return scheduler.get_retrievability(card, now, false);
}
