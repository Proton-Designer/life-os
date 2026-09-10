import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchCardState, loadSessionSettings, submitCardReview, submitSelfExplanation } from "./session/build-session";

/**
 * R5 `core(supabase, userId, ...)` extraction for self_mastery's MCP write
 * surface (grading a review, logging a self-explanation). Deliberately
 * thin: `lib/self-mastery/session/build-session.ts` already has
 * `fetchCardState`/`loadSessionSettings`/`submitCardReview`/
 * `submitSelfExplanation`, all already shaped as `core(supabase, userId,
 * ...)` — none of them call `requireUser()`/`getProfile()`/
 * `getAuthedUser()` internally, so none needed changing to become
 * MCP-reachable. This file is ONLY the orchestration a caller with no
 * cookie session needs, composed from functions that already existed.
 *
 * SCOPE, DELIBERATELY NARROW (team-lead's explicit boundary): grading a
 * review and logging a self-explanation. Nothing here writes `lessons`,
 * `cards`, or `source_chunks` content — those stay ingestion-owned; a
 * model editing its own source material is a loop with no ground truth.
 */

export interface GradeReviewInput {
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  elapsedMs?: number;
  /** An empty/omitted answer is a legitimate, honest "I don't know" attempt — never blocked, same posture submitCardReview already takes. */
  answeredText?: string;
  confidence?: "sure" | "think_so" | "guessing" | null;
  now: Date;
}

export interface GradedReview {
  id: string;
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  scheduledDays: number;
  updatedAt: string;
}

/**
 * The MCP write path's entry into the SAME `submit_review` RPC every other
 * grading path (the session overlay's offline queue, the legacy
 * online-only `gradeCard` Server Action) already uses — never a second,
 * parallel grading mechanism.
 *
 * NOT IDEMPOTENT — do not schedule this action. FSRS advances scheduling
 * state FROM the row's current state (`fetchCardState` reads it,
 * `computeNextState` derives the next state from it, `submit_review`
 * re-validates and writes both the review row and the new card_states row
 * in one transaction). Replaying the SAME grade twice moves the card
 * TWICE — `reps` increments twice, `due_at` advances twice past what one
 * real review earns, and a second `Again` past `state:'review'` would even
 * double-count a lapse. There is no conflict-key or no-op path here the
 * way an upsert-by-natural-key write elsewhere in this program has; a
 * retry is a second, real, distinct grading event from the scheduler's own
 * point of view.
 *
 * `sessionId` is always null here — an MCP-graded review has no
 * app-tracked `work_sessions` row to attribute `cards_reviewed` to, and
 * both `submitCardReview` and `submit_review` already treat a null
 * session_id as a normal, legal case (081_ulm_soft_delete_and_purge.sql:
 * `if p_session_id is not null then update work_sessions...`), not a
 * degraded one.
 */
export async function gradeReviewCore(supabase: SupabaseClient<Database>, userId: string, input: GradeReviewInput): Promise<GradedReview> {
  const currentState = await fetchCardState(supabase, userId, input.cardId);
  if (!currentState) {
    throw new Error(`No card_states row for card "${input.cardId}" on this account — nothing to grade yet.`);
  }
  const { desiredRetention } = await loadSessionSettings(supabase, userId);

  const { reviewId, scheduledDays } = await submitCardReview(supabase, {
    desiredRetention,
    currentState,
    cardId: input.cardId,
    sessionId: null,
    rating: input.rating,
    elapsedMs: input.elapsedMs ?? 0,
    answeredText: input.answeredText ?? "",
    // AI grading assist isn't wired for this path either — never
    // fabricated as a real signal it isn't, same posture the app's own
    // gradeCard (self-mastery-session-actions.ts) already takes.
    aiFeedback: null,
    aiSuggestedRating: null,
    confidence: input.confidence ?? null,
    now: input.now,
  });

  return { id: reviewId, cardId: input.cardId, rating: input.rating, scheduledDays, updatedAt: input.now.toISOString() };
}

export interface LogSelfExplanationInput {
  lessonId: string;
  prompt: string;
  response: string | null;
}

export interface LoggedSelfExplanation {
  id: string;
  lessonId: string;
  updatedAt: string;
}

/**
 * MCP's own entry into the same insert-only `self_explanations` table the
 * app's `logSelfExplanation` Server Action writes (self-mastery-session-
 * actions.ts). Ungraded by design — `response: null` records a skip, never
 * penalised, exactly as valid a row as an answered one, same as the app's
 * own path.
 *
 * NOT IDEMPOTENT — a plain INSERT, no conflict key, no upsert. A retry
 * (identical or different content) creates a genuinely separate row every
 * time; there is nothing here for a repeated call to collide with or
 * overwrite, so replaying it duplicates the reflection log.
 *
 * `sessionId` is always null — same reasoning as `gradeReviewCore`.
 */
export async function logSelfExplanationCore(supabase: SupabaseClient<Database>, userId: string, input: LogSelfExplanationInput): Promise<LoggedSelfExplanation> {
  const result = await submitSelfExplanation(supabase, {
    userId,
    lessonId: input.lessonId,
    sessionId: null,
    prompt: input.prompt,
    response: input.response,
  });
  return { id: result.id, lessonId: input.lessonId, updatedAt: result.createdAt };
}
