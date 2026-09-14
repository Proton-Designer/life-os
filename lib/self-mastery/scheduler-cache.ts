// rebuildSchedulerCache -- materialises `card_states` (R1.5's "derived
// cache") from the append-only `reviews` log, per user. Built against the
// REQUIREMENT ONLY, not against Eng 2's check-scheduler-cache-drift.ts,
// which is deliberately unread (R14: the person who writes the rebuild must
// not be the person who writes the check on it, or an ambiguity in the
// requirement disappears into one person's private resolution of it instead
// of surfacing as a disagreement between two independent readings).
//
// EXTENDED TO QUESTIONS 2026-09-14 (#24/#26, this batch). R1 (111,
// reviews.question_id / card_states.question_id, the XOR extension) landed
// on production well before this file's own header noticed -- exactly the
// same shape of stale claim 126's header carried about card_states.card_id
// (corrected by 127's own header, which is where this discipline is
// borrowed from: never edit an APPLIED migration file to fix a claim it
// got wrong, correct it at the next place that depends on the claim
// instead). This comment block is that correction for THIS file.
//
// The extension is exactly what the original comment below predicted:
// additive, a second branch alongside the card one, same shape --
// `rebuildOneItem` (the pure computational core) needed ZERO changes, since
// it already operates on `ReviewRow[]` with no `card_id`/`question_id`
// field in sight. Only `rebuildSchedulerCache` (the orchestration around
// it -- which table to read reviews FROM, which table to upsert INTO, and
// under which conflict target) gained a question arm.
//
// ORIGINAL NOTE, kept for the historical record it still accurately
// describes (the REBUILT-FROM-STORED-VALUES rules below apply identically
// to both arms):
//
// WHAT IS REBUILT FROM STORED VALUES, NEVER RECOMPUTED (the hard
// requirement, restated so the choice is visible at every call site):
//   stability   <- last review's stability_after
//   difficulty  <- last review's difficulty_after
//   due_at      <- last review's reviewed_at + last review's scheduled_days
//   reps        <- count of the item's reviews
//   lapses      <- count(rating = 1 AND state_before = 'review') directly
//                  over stored rows -- NEVER replayed through the
//                  scheduler. Matches submit_review's CORRECTED formula
//                  (see the R1 draft §4a) exactly, not the pre-fix one.
//   state       <- last review's state_after
//   learning_steps <- last review's learning_steps_after (R17 -- see
//                  ULM/docs/notes/r1-reviews-card-states-migration-draft.md
//                  §1/§3. The bug this closes is fsrs-scheduler.ts's
//                  toFsrsCard hardcoding this to 0 on every re-hydration,
//                  owned and fixed by LifeOS Eng 1 in that file, not here --
//                  this module's job is only to make sure the CACHE this
//                  rebuild materialises carries the real value too, so a
//                  rebuild never reintroduces the bug by producing a
//                  card_states row with a wrong learning_steps.)
// ZERO scheduler calls anywhere in this file -- `getScheduler`/
// `computeNextState`/`toFsrsCard` are not imported. `now()` never appears
// either -- every timestamp used is a review's own real, historical
// `reviewed_at`.
//
// HISTORY, KEPT BECAUSE THE REASONING STILL MATTERS: `state` was originally
// the one field with no stored column to read (`reviews.state_before`
// existed, `state_after` did not), and this file's first version used one
// narrowly-scoped scheduler call to derive it -- flagged to the Lead rather
// than silently decided. Ruling, 2026-09-02: add `reviews.state_after`
// instead, for five reasons recorded in the R1 draft (`ULM/docs/notes/
// r1-reviews-card-states-migration-draft.md` §5), the sharpest being that
// Eng 2 independently hit the identical gap building the drift check from
// the same requirement text, without seeing this file -- two independent
// readings landing on the same missing column is strong evidence it's
// structural, not one engineer's inconvenience (R14 paying for itself).
// This file now reads `state_after` like every other field: a stored
// column, not a derivation. `reviews.state_after` has not landed yet
// (pending a migration number) -- this file is written against the target
// schema, same posture as the rest of this repo's R1-gated code.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DbFsrsState } from "./fsrs-scheduler";

type SupabaseAdmin = ReturnType<typeof createClient<Database>>;

export interface ReviewRow {
  rating: number;
  reviewed_at: string;
  state_before: DbFsrsState;
  state_after: DbFsrsState;
  stability_after: number | null;
  difficulty_after: number | null;
  scheduled_days: number | null;
  learning_steps_after: number;
}

export interface CardStateSnapshot {
  stability: number | null;
  difficulty: number | null;
  due_at: string | null;
  reps: number;
  lapses: number;
  state: DbFsrsState;
  last_review_at: string | null;
  last_rating: number | null;
  learning_steps: number;
}

export interface DivergedField {
  cardId: string;
  field: keyof CardStateSnapshot;
  cached: unknown;
  rebuilt: unknown;
}

export interface RebuildResult {
  cardsRebuilt: number;
  questionsRebuilt: number;
  divergedFromExisting: DivergedField[];
}

/** Exported for direct unit testing (no DB, no PostgREST) -- the pure
 * computational core rebuildSchedulerCache calls per item. Every field is a
 * stored-column read or a direct count/filter over stored rows -- no
 * scheduler call, no `now()`, anywhere in this function. */
export function rebuildOneItem(reviews: ReviewRow[]): CardStateSnapshot {
  if (reviews.length === 0) {
    throw new Error("rebuildOneItem: called with zero reviews -- caller must group by item and skip empty groups");
  }
  const ordered = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  const latest = ordered[ordered.length - 1]!;

  const reps = ordered.length;
  const lapses = ordered.filter((r) => r.rating === 1 && r.state_before === "review").length;

  const stability = latest.stability_after;
  const difficulty = latest.difficulty_after;
  const due_at =
    latest.scheduled_days === null
      ? null
      : new Date(new Date(latest.reviewed_at).getTime() + latest.scheduled_days * 86_400_000).toISOString();

  return {
    stability,
    difficulty,
    due_at,
    reps,
    lapses,
    state: latest.state_after,
    learning_steps: latest.learning_steps_after,
    last_review_at: latest.reviewed_at,
    last_rating: latest.rating,
  };
}

/**
 * Rebuilds `card_states` for `userId` from `reviews`, per-item, per the
 * header's rules -- now over BOTH item kinds (cards and, since 111/this
 * batch's #24, questions), each its own arm, sharing `rebuildOneItem`.
 * Idempotent: a second call with no intervening reviews produces the
 * identical snapshot for every item (pure function of an append-only log),
 * so `divergedFromExisting` comes back empty on the second run if it was
 * empty on the first. A user with zero reviews of either kind is a clean
 * no-op (`cardsRebuilt: 0, questionsRebuilt: 0`), not an error. Every query
 * is scoped to `userId` explicitly -- this is written to run under a
 * service-role client (RLS bypassed), so the scoping is enforced here, not
 * left to RLS.
 */
export async function rebuildSchedulerCache(supabase: SupabaseAdmin, userId: string): Promise<RebuildResult> {
  const { data: reviewRows, error: reviewsError } = await supabase
    .from("reviews")
    .select(
      "card_id, question_id, rating, reviewed_at, state_before, state_after, stability_after, difficulty_after, scheduled_days, learning_steps_after",
    )
    .eq("user_id", userId)
    .order("reviewed_at", { ascending: true });
  if (reviewsError) throw reviewsError;
  if (!reviewRows || reviewRows.length === 0) {
    return { cardsRebuilt: 0, questionsRebuilt: 0, divergedFromExisting: [] };
  }

  const byCard = new Map<string, ReviewRow[]>();
  const byQuestion = new Map<string, ReviewRow[]>();
  for (const row of reviewRows) {
    // `reviews_item_xor` (111) guarantees exactly one of card_id/question_id
    // is set on every row -- no third case to handle.
    const reviewRow: ReviewRow = {
      rating: row.rating,
      reviewed_at: row.reviewed_at,
      state_before: row.state_before as DbFsrsState,
      state_after: row.state_after as DbFsrsState,
      stability_after: row.stability_after,
      difficulty_after: row.difficulty_after,
      scheduled_days: row.scheduled_days,
      learning_steps_after: row.learning_steps_after as number,
    };
    if (row.card_id) {
      const cardId = row.card_id as string;
      const list = byCard.get(cardId) ?? [];
      list.push(reviewRow);
      byCard.set(cardId, list);
    } else if (row.question_id) {
      const questionId = row.question_id as string;
      const list = byQuestion.get(questionId) ?? [];
      list.push(reviewRow);
      byQuestion.set(questionId, list);
    }
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("card_states")
    .select("card_id, question_id, stability, difficulty, due_at, reps, lapses, state, last_review_at, last_rating, learning_steps")
    .eq("user_id", userId);
  if (existingError) throw existingError;
  const existingByCard = new Map((existingRows ?? []).filter((r) => r.card_id).map((r) => [r.card_id as string, r]));
  const existingByQuestion = new Map((existingRows ?? []).filter((r) => r.question_id).map((r) => [r.question_id as string, r]));

  // card_states.book_id is nullable (111/127) but must still be non-null for
  // a CARD-backed row (card_states_book_id_matches_card) -- derive it from
  // `cards`, never trusted from any other source, for every card this
  // rebuild is about to upsert (including cards with no existing
  // card_states row yet, which have no other source for it). A
  // question-backed row's book_id is always null (no lookup needed).
  const cardIds = Array.from(byCard.keys());
  const bookIdByCard = new Map<string, string>();
  if (cardIds.length > 0) {
    const { data: cardRows, error: cardsError } = await supabase
      .from("cards")
      .select("id, book_id")
      .in("id", cardIds);
    if (cardsError) throw cardsError;
    for (const r of cardRows ?? []) bookIdByCard.set(r.id as string, r.book_id as string);
  }

  const diverged: DivergedField[] = [];
  const cardUpserts: Array<CardStateSnapshot & { card_id: string; question_id: null; user_id: string; book_id: string }> = [];
  const questionUpserts: Array<CardStateSnapshot & { card_id: null; question_id: string; user_id: string; book_id: null }> = [];

  const diffFields = ["stability", "difficulty", "due_at", "reps", "lapses", "state", "last_review_at", "last_rating", "learning_steps"] as const;

  for (const [cardId, reviews] of byCard) {
    const rebuilt = rebuildOneItem(reviews);
    const existing = existingByCard.get(cardId);
    if (existing) {
      for (const field of diffFields) {
        if (existing[field] !== rebuilt[field]) {
          diverged.push({ cardId, field, cached: existing[field], rebuilt: rebuilt[field] });
        }
      }
    }
    const bookId = bookIdByCard.get(cardId);
    if (!bookId) {
      throw new Error(`rebuildSchedulerCache: card ${cardId} has reviews but no matching cards row (or a book_id) -- refusing to upsert an orphaned reference`);
    }
    cardUpserts.push({ ...rebuilt, card_id: cardId, question_id: null, user_id: userId, book_id: bookId });
  }

  for (const [questionId, reviews] of byQuestion) {
    const rebuilt = rebuildOneItem(reviews);
    const existing = existingByQuestion.get(questionId);
    if (existing) {
      for (const field of diffFields) {
        if (existing[field] !== rebuilt[field]) {
          diverged.push({ cardId: questionId, field, cached: existing[field], rebuilt: rebuilt[field] });
        }
      }
    }
    questionUpserts.push({ ...rebuilt, card_id: null, question_id: questionId, user_id: userId, book_id: null });
  }

  if (cardUpserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("card_states")
      .upsert(cardUpserts, { onConflict: "card_id,user_id" });
    if (upsertError) throw upsertError;
  }
  if (questionUpserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("card_states")
      .upsert(questionUpserts, { onConflict: "question_id,user_id" });
    if (upsertError) throw upsertError;
  }

  return { cardsRebuilt: cardUpserts.length, questionsRebuilt: questionUpserts.length, divergedFromExisting: diverged };
}
