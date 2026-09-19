"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import {
  buildTodaysSession,
  fetchCardAnswer as fetchCardAnswerCore,
  fetchQuestionAnswer as fetchQuestionAnswerCore,
  fetchLessonContext as fetchLessonContextCore,
  fetchCardState,
  fetchQuestionState,
  submitCardReview,
  submitQuestionReview,
  loadSessionSettings,
  completeTodaysSession,
  computeSessionBookStrengths,
  countDueCards,
  countNewCards,
  countDueTomorrow,
  fetchDueCardDetail,
  submitSelfExplanation as submitSelfExplanationCore,
  fetchSessionStudyMethods,
  type LessonContext,
} from "@/lib/self-mastery/session/build-session";
import type { BuiltSession, SessionCompletionResult } from "@/lib/self-mastery/session/types";
import type { StudyMethodId } from "@/lib/self-mastery/study-methods";
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

/** Question-path twin of `revealCardAnswer` -- same separate-fetch-after-commit discipline, for the same reason (see that function's doc). */
export async function revealQuestionAnswer(questionId: string): Promise<string> {
  const { supabase } = await requireUser();
  return fetchQuestionAnswerCore(supabase, questionId);
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
    userId,
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

export interface GradeQuestionInput {
  questionId: string;
  sessionId: string;
  rating: 1 | 2 | 3 | 4;
  elapsedMs: number;
  answeredText: string;
  confidence: "sure" | "think_so" | "guessing" | null;
  /** The raw outcome (`reviews.correct`, 111) -- distinct from the derived `rating`. See submitQuestionReview's own input doc. */
  correct: boolean | null;
}

/**
 * Question-path twin of `gradeCard` (#26) -- same online-only shape,
 * `submitQuestionReview` instead of `submitCardReview`. UNLIKE the card
 * path, THIS IS THE ONLY WAY a question review is ever submitted in this
 * pass: there is no offline queue for questions (Opus Lead's explicit
 * scoping -- #24/#26's cut line stops at online-only), so a thrown error
 * here has nowhere else to land and MUST propagate to the caller, never be
 * swallowed. The overlay's own call site is responsible for keeping the
 * user's typed answer in state on that rejection so a retry doesn't start
 * from a blank field -- see retrieval-session-overlay.tsx.
 */
export async function gradeQuestion(input: GradeQuestionInput): Promise<{ scheduledDays: number }> {
  const { supabase, userId } = await requireUser();
  const currentState = await fetchQuestionState(supabase, userId, input.questionId);
  const { desiredRetention } = await loadSessionSettings(supabase, userId);
  const { scheduledDays } = await submitQuestionReview(supabase, {
    desiredRetention,
    userId,
    currentState,
    questionId: input.questionId,
    sessionId: input.sessionId,
    rating: input.rating,
    elapsedMs: input.elapsedMs,
    answeredText: input.answeredText,
    // Same discipline as gradeCard: AI grading assist isn't wired in this
    // pass, never fabricated as a real signal.
    aiFeedback: null,
    aiSuggestedRating: null,
    confidence: input.confidence,
    correct: input.correct,
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

/** Question-path twin of `fetchCurrentCardState` -- same read-only, scheduling-numbers-only discipline. */
export async function fetchCurrentQuestionState(questionId: string) {
  const { supabase, userId } = await requireUser();
  return fetchQuestionState(supabase, userId, questionId);
}

/** Revalidates Home after a grading pass — called once the overlay knows a review actually landed (immediate success or a replayed one), not on every optimistic advance. */
export async function revalidateAfterReview(): Promise<void> {
  revalidatePath("/");
}

export interface FinishSessionResult extends SessionCompletionResult {
  dueTomorrow: number;
  /** P3-03: whichever named study techniques this session actually recorded (lib/self-mastery/study-methods.ts). Empty for a session that touched nothing. */
  studyMethods: StudyMethodId[];
}

/**
 * complete_session is idempotent server-side — safe to call twice. Computes
 * countDueTomorrow AT completion time (not session start), per the spec:
 * "so it survives a midnight-crossing session."
 */
export async function finishSession(sessionId: string): Promise<FinishSessionResult> {
  const { supabase, userId } = await requireUser();
  const { localDate, timezone } = await resolveLocalDate();
  // P2-17: per-book retrievability for whatever book(s) this session
  // touched, computed BEFORE calling complete_session so the RPC's
  // book_milestone check (migration 200) has real numbers to test against
  // — {} for a question-only/empty session is a legitimate no-op, not an
  // error (computeSessionBookStrengths's own contract).
  const bookStrengths = await computeSessionBookStrengths(supabase, userId, sessionId, new Date());
  const [result, dueTomorrow, studyMethods] = await Promise.all([
    completeTodaysSession(supabase, sessionId, bookStrengths),
    countDueTomorrow(supabase, userId, localDate, timezone),
    fetchSessionStudyMethods(supabase, sessionId),
  ]);
  revalidatePath("/");
  return { ...result, dueTomorrow, studyMethods };
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
   * Whether the account has at least one book at all. Distinguishes a
   * genuinely empty library (never added a book -- show a real "add a
   * book" prompt) from a caught-up one (an existing book with nothing
   * currently due/new -- show "Nothing due today") when dueCount and
   * newCount are both zero. See session-entry-card.tsx for the distinct
   * copy this drives.
   *
   * [ONB item 11, 2026-09-19] This field used to be `starterDeckMissing`:
   * onboarding auto-seeded a sample Marcus Aurelius deck for every
   * Self-Mastery account, and zero books was the reliable signal that
   * seed had failed (Boss ruling R7: "a seed failure must be visible,
   * never silent"), driving a "Your starter deck didn't load" retry
   * nudge. Ayman removed the automatic seed (a new account showing "47
   * cards ready to start" out of nowhere was itself the bug) -- R7 is
   * moot now, not overturned: there is no seed left to fail, so zero
   * books is always a genuine, first-class empty state.
   */
  hasBooks: boolean;
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
    return { dueCount: 0, newCount: 0, estimatedMinutes: 0, hasBooks: (count ?? 0) > 0 };
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
  return { dueCount, newCount, estimatedMinutes, hasBooks: true };
}

/**
 * Real evidence for the arbiter's Self-Mastery candidate (R19, R28-
 * restated item 1's admission gate generalized): `hasCandidate` is the
 * gate -- true only when there's something real to offer (dueCount or
 * newCount > 0, the same condition getDueSummary itself uses to decide
 * "nothing to show"). An account with zero books, or a genuinely
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
