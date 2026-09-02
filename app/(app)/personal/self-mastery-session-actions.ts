"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import {
  buildTodaysSession,
  fetchCardAnswer as fetchCardAnswerCore,
  fetchLessonContext as fetchLessonContextCore,
  fetchCardState,
  submitCardReview,
  loadSessionSettings,
  completeTodaysSession,
  countDueCards,
  countNewCards,
  countDueTomorrow,
  fetchDueCardDetail,
  submitSelfExplanation as submitSelfExplanationCore,
  type LessonContext,
} from "@/lib/self-mastery/session/build-session";
import { seedMeditationsDeckForUser as seedMeditationsDeckForUserCore } from "@/lib/self-mastery/seed-meditations-deck";
import type { BuiltSession, SessionCompletionResult } from "@/lib/self-mastery/session/types";
import type { SelfMasterySummary } from "@/lib/home/build-candidates";

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

/**
 * The lesson's `mechanism`/`action_template` for the card just revealed —
 * same reveal-only discipline as revealCardAnswer, for the same reason: a
 * "why"/"application" prompt can be testing exactly this content, so
 * fetching it before commit would hand the user the answer. Read-only, no
 * promotion flow.
 */
export async function revealLessonContext(lessonId: string): Promise<LessonContext> {
  const { supabase } = await requireUser();
  return fetchLessonContextCore(supabase, lessonId);
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
  // Load the caller's own desired_retention rather than letting the scheduler
  // fall back to 0.9. Without this the path schedules every review at the
  // default no matter what the user chose — see submitCardReview's comment.
  const { desiredRetention } = await loadSessionSettings(supabase, userId);
  const { scheduledDays } = await submitCardReview(supabase, {
    desiredRetention,
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
export interface DueSummary {
  dueCount: number;
  /**
   * Never-reviewed cards (state='new'), separate from dueCount --
   * get_session_queue's own "due" query excludes these the same way
   * (new material has no scheduled due date to compare against `now`).
   * A brand-new account with a freshly seeded deck has dueCount=0 not
   * because they're caught up, but because nothing's been touched yet --
   * this field is what lets the entry card tell those two states apart
   * (Opus Lead, stranger-journey e2e: "Nothing due today" on day one reads
   * as broken, not as "not started").
   */
  newCount: number;
  estimatedMinutes: number;
  /**
   * true only when nothing is due, nothing is new, AND the user has zero
   * books at all (Boss ruling, R7: a silent onboarding-seed failure must
   * become a visible signal, not a screen indistinguishable from "caught
   * up"). completeOnboarding calls seedMeditationsDeckForUser exactly
   * once, synchronously, before Home can ever render, and deliberately
   * swallows its failure rather than blocking the user's first reach of
   * the app -- so by the time this function ever runs, seeding has
   * definitely already been attempted. Zero books for an account that
   * kept Self-Mastery therefore reliably means it failed (or, for an
   * account that added Self-Mastery after onboarding, was never attempted
   * -- the same "no deck yet" state, fixed the same way: retry). Never
   * true once a book exists, regardless of how caught-up its cards are --
   * an existing book with zero due/new cards is a real, legitimate "you're
   * done for now," not a failure. See session-entry-card.tsx for the
   * distinct copy this drives.
   */
  starterDeckMissing: boolean;
}

export async function getDueSummary(): Promise<DueSummary | null> {
  const user = await getAuthedUser();
  if (!user) return null;
  const supabase = await createClient();
  const [dueCount, newCount] = await Promise.all([
    countDueCards(supabase, user.id, new Date()),
    countNewCards(supabase, user.id),
  ]);
  if (dueCount === 0 && newCount === 0) {
    const { count } = await supabase.from("books").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    return { dueCount: 0, newCount: 0, estimatedMinutes: 0, starterDeckMissing: (count ?? 0) === 0 };
  }
  const { data } = await supabase
    .from("user_settings")
    .select("session_target_minutes")
    .eq("user_id", user.id)
    .maybeSingle();
  // No user_settings row yet (never started a session) -- the column's own
  // default (066), not re-derived here, so this stays the one place that
  // default lives.
  const estimatedMinutes = data?.session_target_minutes ?? 8;
  return { dueCount, newCount, estimatedMinutes, starterDeckMissing: false };
}

/**
 * Real evidence for the arbiter's Self-Mastery candidate (R19, R28-
 * restated item 1's admission gate generalized): `hasCandidate` is the
 * gate -- true only when there's something real to offer (dueCount or
 * newCount > 0, the same condition getDueSummary itself uses to decide
 * "nothing to show"). A starter deck that never seeded, or a genuinely
 * caught-up account, both correctly produce hasCandidate: false here --
 * there is no real Self-Mastery work to rank in either case, which is
 * different from "we don't know" (R37's distinction, restated for this
 * source): this isn't a missing-evidence case, it's a real absence of
 * anything to do.
 *
 * `dueAt`/`decay` describe only the DUE subset and stay null for a fresh,
 * never-touched deck (real NEW cards, nothing due yet) -- that's still a
 * real candidate via `hasCandidate`, just one with no due-card evidence
 * to report. `cost` reuses getDueSummary's own `estimatedMinutes` rather
 * than re-deriving it -- one estimate, one source of truth, same value
 * SessionEntryCard already shows the user.
 */
/**
 * Takes an ALREADY-FETCHED DueSummary rather than calling getDueSummary()
 * itself -- page.tsx already fetches it once (unconditionally, for
 * SessionEntryCard); getDueSummary isn't cache()-wrapped the way
 * getUserDomains is, so a second internal call here would be a real
 * duplicate round trip (2x countDueCards, 2x countNewCards, ...), not a
 * free re-read.
 */
export async function getSelfMasteryCandidateInput(summary: DueSummary | null): Promise<SelfMasterySummary> {
  const hasCandidate = !!summary && (summary.dueCount > 0 || summary.newCount > 0);
  if (!summary || !hasCandidate) {
    return { hasCandidate: false, dueAt: null, decay: null, cost: null };
  }
  const { supabase, userId } = await requireUser();
  const detail = await fetchDueCardDetail(supabase, userId, new Date());
  return {
    hasCandidate: true,
    dueAt: detail.earliestDueAt ? new Date(detail.earliestDueAt) : null,
    decay: detail.lowestRetrievability,
    cost: summary.estimatedMinutes,
  };
}

/**
 * Home's visible retry for a starter deck that never seeded (Boss ruling,
 * R7 -- "a seed failure must be visible... never silent"). Safe to call any
 * number of times: seed_meditations_deck (the RPC underneath) is
 * idempotent and self-gates on the self_mastery subdomain, so a repeat
 * call either seeds a genuinely missing deck or is a documented no-op --
 * it never duplicates a book that already exists.
 */
export async function retryStarterDeckSeed(): Promise<{ ok: boolean }> {
  const { supabase } = await requireUser();
  try {
    const result = await seedMeditationsDeckForUserCore(supabase);
    revalidatePath("/");
    return { ok: result.seeded };
  } catch {
    return { ok: false };
  }
}
