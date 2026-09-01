"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import {
  buildTodaysSession,
  fetchCardAnswer as fetchCardAnswerCore,
  fetchCardState,
  submitCardReview,
  completeTodaysSession,
  countDueCards,
  countDueTomorrow,
  submitSelfExplanation as submitSelfExplanationCore,
} from "@/lib/self-mastery/session/build-session";
import type { BuiltSession, SessionCompletionResult } from "@/lib/self-mastery/session/types";

/**
 * Resolves "today" server-side from the caller's own stored timezone
 * (profiles.timezone), NOT from a client-supplied date string — a
 * deliberate departure from ULM's own spec ("the client computes the local
 * date and passes it in"), for a reason specific to this repo: every other
 * local-date resolution here goes through `localDateString(now, timezone)`
 * against the profile's stored timezone, never a client-supplied value,
 * and AGENTS.md records this exact bug class shipping four times. Using
 * the same server-authoritative pattern here (rather than trusting a
 * browser's own clock/timezone, correct as that would also be on a real
 * device) keeps this one consistent with everything else in the app
 * instead of introducing a second, different way to resolve "today."
 */
async function resolveLocalDate(): Promise<{ localDate: string; timezone: string; userId: string }> {
  const user = await getAuthedUser();
  if (!user) throw new Error("resolveLocalDate: no authenticated user");
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  return { localDate: localDateString(new Date(), timezone), timezone, userId: user.id };
}

/**
 * The one entry point the session screen calls to load (or resume) today's
 * queue. Safe to call every time the screen mounts — start_session itself
 * resumes an incomplete same-local-date session rather than creating a
 * duplicate (D-014: retrieval sessions join, they don't compete — but
 * against their OWN kind='learn' check, never Lock-In's, which deliberately
 * excludes 'learn' via counts_toward_hours).
 */
export async function loadTodaysSession(): Promise<BuiltSession> {
  const { supabase, userId } = await requireUser();
  const { localDate } = await resolveLocalDate();
  return buildTodaysSession(supabase, { userId, localDate, now: new Date() });
}

/**
 * Reveal — a SEPARATE fetch, fired only after the user has committed an
 * attempt. This function existing at all, distinct from whatever loaded the
 * queue, is the non-negotiable invariant made structural rather than a UI
 * convention: nothing calls this in a batch, nothing calls it before
 * commit.
 */
export async function revealCardAnswer(cardId: string): Promise<string> {
  const { supabase } = await requireUser();
  return fetchCardAnswerCore(supabase, cardId);
}

export interface GradeCardInput {
  cardId: string;
  sessionId: string;
  rating: 1 | 2 | 3 | 4;
  elapsedMs: number;
  answeredText: string;
  confidence: "sure" | "think_so" | "guessing" | null;
}

/**
 * Kept for a call site that isn't going through the offline queue (none as
 * of this writing — the overlay uses fetchCurrentCardState +
 * client-computed FSRS + enqueue/replay below instead, specifically
 * because a Server Action's thrown error is redacted to a generic message
 * in production, which would silently defeat offline-queue.ts's retry
 * classifier: it string-matches submit_review's REAL Postgres error text,
 * which only survives over a direct Supabase client call, never through a
 * Next.js Server Action boundary). Left in place as the simpler, correct
 * online-only path if a future caller doesn't need offline support.
 */
export async function gradeCard(input: GradeCardInput): Promise<{ scheduledDays: number }> {
  const { supabase, userId } = await requireUser();
  const currentState = await fetchCardState(supabase, userId, input.cardId);
  const { scheduledDays } = await submitCardReview(supabase, {
    currentState,
    cardId: input.cardId,
    sessionId: input.sessionId,
    rating: input.rating,
    elapsedMs: input.elapsedMs,
    answeredText: input.answeredText,
    // AI grading assist isn't wired in this pass — never fabricated as a
    // real signal it isn't. See session-screen-spec.md §5's copy
    // discipline: "Suggested grade" would need real token-overlap logic
    // behind it, not a placeholder.
    aiFeedback: null,
    aiSuggestedRating: null,
    confidence: input.confidence,
    now: new Date(),
  });
  revalidatePath("/");
  return { scheduledDays };
}

/**
 * Read-only, scheduling-numbers-only (no prompt/answer text) — safe to call
 * any time. The overlay calls this immediately before computing the next
 * FSRS state client-side, so the offline queue can carry a fully-computed
 * `nextState` and never needs a network round trip to compute it at replay
 * time.
 */
export async function fetchCurrentCardState(cardId: string) {
  const { supabase, userId } = await requireUser();
  return fetchCardState(supabase, userId, cardId);
}

/** Revalidates Home after a grading pass — called once the overlay knows a review actually landed (immediate success or a replayed one), not on every optimistic advance. */
export async function revalidateAfterReview(): Promise<void> {
  revalidatePath("/");
}

export interface FinishSessionResult extends SessionCompletionResult {
  dueTomorrow: number;
}

/**
 * complete_session is idempotent server-side — safe to call twice. Computes
 * countDueTomorrow AT completion time (not session start), per the spec:
 * "so it survives a midnight-crossing session."
 */
export async function finishSession(sessionId: string): Promise<FinishSessionResult> {
  const { supabase, userId } = await requireUser();
  const { localDate, timezone } = await resolveLocalDate();
  const [result, dueTomorrow] = await Promise.all([
    completeTodaysSession(supabase, sessionId),
    countDueTomorrow(supabase, userId, localDate, timezone),
  ]);
  revalidatePath("/");
  return { ...result, dueTomorrow };
}

export interface LogSelfExplanationInput {
  lessonId: string;
  sessionId: string;
  prompt: string;
  /** null = skipped. Never penalised, never blocked — see build-session.ts's submitSelfExplanation. */
  response: string | null;
}

export async function logSelfExplanation(input: LogSelfExplanationInput): Promise<void> {
  const { supabase, userId } = await requireUser();
  await submitSelfExplanationCore(supabase, {
    userId,
    lessonId: input.lessonId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    response: input.response,
  });
}

/**
 * The Home affordance's own read — "N cards due, ~M min." Deliberately
 * separate from loadTodaysSession: Home must be able to show this WITHOUT
 * calling start_session (which would create/resume a real work_sessions
 * row just for a user glancing at Home who never taps in). Never throws —
 * a render-path read for a user with nothing due (or no Self-Mastery
 * setup at all) returns zero, not an error; getAuthedUser() degrades the
 * same way getUserDomains/getOnboardingState already do.
 */
export async function getDueSummary(): Promise<{ dueCount: number; estimatedMinutes: number } | null> {
  const user = await getAuthedUser();
  if (!user) return null;
  const supabase = await createClient();
  const dueCount = await countDueCards(supabase, user.id, new Date());
  if (dueCount === 0) return { dueCount: 0, estimatedMinutes: 0 };
  const { data } = await supabase
    .from("user_settings")
    .select("session_target_minutes")
    .eq("user_id", user.id)
    .maybeSingle();
  // No user_settings row yet (never started a session) -- the column's own
  // default (066), not re-derived here, so this stays the one place that
  // default lives.
  const estimatedMinutes = data?.session_target_minutes ?? 8;
  return { dueCount, estimatedMinutes };
}
