// Supabase orchestration for the retrieval session — adapted from ULM's
// packages/core/src/session/index.ts. Two real adaptations beyond a
// mechanical port, both load-bearing:
//
// 1. ULM's `sessions` table doesn't exist on this platform — every read/
//    write here targets `work_sessions` (kind='learn'), and `completedAt`
//    became `endedAt` to match that table's real column name (057, 078).
// 2. ULM's own `localDayBoundsUTC` (packages/core/src/session/local-date.ts)
//    derives day bounds from the RUNTIME's local Date getters
//    (`date.getFullYear()`/etc.) — correct on a user's own device, wrong on
//    a server, which has no reason to run in the user's timezone. Ported to
//    this repo's own `resolveLocalTime`/`addDaysToDateString` instead (per
//    AGENTS.md's calendar-date rule — this class has shipped four times
//    already) rather than porting local-date.ts's own file. The ULM lead's
//    own review flagged this exact swap before it was built.
import { createClient } from "@/lib/supabase/server";
import { addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { getScheduler, toFsrsCard, toRpcNextState, computeNextState, type DbCardState } from "@/lib/self-mastery/fsrs-scheduler";
import { computeMedianElapsedMs, estimateSessionCapacity, allocateQueueLimits } from "./queue-limits";
import { groupQueueIntoPlan } from "./plan";
import type {
  BuiltSession,
  EffortfulWinMoment,
  FreezeConsumed,
  PromptType,
  QueueEntry,
  QueueReason,
  RawSession,
  SessionCard,
  SessionCompletionResult,
  SessionSettings,
} from "./types";

type TypedClient = Awaited<ReturnType<typeof createClient>>;

export async function loadSessionSettings(client: TypedClient, userId: string): Promise<SessionSettings> {
  const { data, error } = await client
    .from("user_settings")
    .select("session_target_minutes, daily_new_limit, ai_grading_enabled, desired_retention")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return {
    sessionTargetMinutes: data.session_target_minutes,
    dailyNewLimit: data.daily_new_limit,
    aiGradingEnabled: data.ai_grading_enabled,
    desiredRetention: Number(data.desired_retention),
  };
}

export async function loadRecentElapsedMs(client: TypedClient, userId: string, limit = 50): Promise<number[]> {
  const { data, error } = await client
    .from("reviews")
    .select("elapsed_ms")
    .eq("user_id", userId)
    .order("reviewed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.elapsed_ms).filter((ms): ms is number => ms !== null);
}

export async function countDueCards(client: TypedClient, userId: string, now: Date): Promise<number> {
  const { count, error } = await client
    .from("card_states")
    .select("card_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("state", "new")
    .lte("due_at", now.toISOString());
  if (error) throw error;
  return count ?? 0;
}

/**
 * Cards never reviewed at all (`state = 'new'`) — deliberately separate
 * from countDueCards, which excludes them (get_session_queue's own "due"
 * CTE excludes state='new' the same way, matching that RPC's own reason,
 * new material has no scheduled due date to be lte(now) against). A
 * brand-new account with a freshly seeded/ingested deck has zero due cards
 * by this definition, not because there's nothing to study but because
 * nothing has been touched yet — the distinction the Home affordance's
 * copy needs so day one doesn't read as "Nothing due today" (which sounds
 * like caught-up-and-done) when the honest state is "ready to start."
 */
export async function countNewCards(client: TypedClient, userId: string): Promise<number> {
  const { count, error } = await client
    .from("card_states")
    .select("card_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("state", "new");
  if (error) throw error;
  return count ?? 0;
}

/**
 * "N cards due tomorrow" — the session-complete preview. Computed
 * client-side from stored FSRS state, no RPC needed. `todayStr`/`timezone`
 * should reflect "now" at session-complete time, not session-start time — a
 * session can span into a new local day, and "tomorrow" should always mean
 * the day after whichever day it actually is when this is shown.
 */
export async function countDueTomorrow(
  client: TypedClient,
  userId: string,
  todayStr: string,
  timezone: string
): Promise<number> {
  const tomorrowStr = addDaysToDateString(todayStr, 1);
  const dayAfterStr = addDaysToDateString(todayStr, 2);
  const startUTC = resolveLocalTime(tomorrowStr, "00:00", timezone).toISOString();
  const endUTC = resolveLocalTime(dayAfterStr, "00:00", timezone).toISOString();
  const { count, error } = await client
    .from("card_states")
    .select("card_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("state", "new")
    .gte("due_at", startUTC)
    .lt("due_at", endUTC);
  if (error) throw error;
  return count ?? 0;
}

/** Calls `start_session`, which itself resumes an incomplete same-local-date session rather than creating a duplicate — safe to call every time the session screen mounts. */
export async function startTodaysSession(client: TypedClient, localDate: string): Promise<RawSession> {
  const { data, error } = await client.rpc("start_session", { p_local_date: localDate });
  if (error) throw error;
  return {
    id: data.id,
    userId: data.user_id,
    localDate: data.local_date ?? localDate,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    cardsReviewed: data.cards_reviewed ?? 0,
    newCardsIntroduced: data.new_cards_introduced ?? 0,
  };
}

export async function fetchQueueEntries(
  client: TypedClient,
  limits: { limitDue: number; limitNew: number }
): Promise<QueueEntry[]> {
  const { data, error } = await client.rpc("get_session_queue", {
    p_limit_due: limits.limitDue,
    p_limit_new: limits.limitNew,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    cardId: row.card_id,
    bookId: row.book_id,
    queuePosition: row.queue_position,
    reason: row.reason as QueueReason,
  }));
}

/** Hydrates queue entries into displayable cards. Selects `id, lesson_id, prompt_type, prompt` — NEVER `answer`. See lib/self-mastery/session/types.ts's SessionCard doc for why this is a security invariant, not a style choice. */
export async function hydrateQueueCards(client: TypedClient, entries: QueueEntry[]): Promise<SessionCard[]> {
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.cardId);
  const { data, error } = await client.from("cards").select("id, lesson_id, prompt_type, prompt").in("id", ids);
  if (error) throw error;

  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  const hydrated: SessionCard[] = [];
  for (const entry of entries) {
    const row = byId.get(entry.cardId);
    // A card can vanish between get_session_queue's snapshot and this fetch
    // (deleted lesson/book mid-session). Skip it, don't crash the queue.
    if (!row) continue;
    hydrated.push({
      id: row.id,
      lessonId: row.lesson_id,
      bookId: entry.bookId,
      promptType: row.prompt_type as PromptType,
      prompt: row.prompt,
      reason: entry.reason,
      queuePosition: entry.queuePosition,
    });
  }
  return hydrated;
}

/** Reads a single card's `answer`. Call this only after the user has committed an attempt — never to pre-fetch, never in a batch. THE non-negotiable invariant lives here: this is the one function in the whole session module allowed to select `answer`. */
export async function fetchCardAnswer(client: TypedClient, cardId: string): Promise<string> {
  const { data, error } = await client.from("cards").select("answer").eq("id", cardId).single();
  if (error) throw error;
  return data.answer;
}

/** Reads a card's current FSRS scheduling state — the input submitCardReview needs to compute the next state. Contains no prompt/answer text, only scheduling numbers. `null` means the card has never been reviewed. */
export async function fetchCardState(client: TypedClient, userId: string, cardId: string): Promise<DbCardState | null> {
  const { data, error } = await client
    .from("card_states")
    .select("stability, difficulty, due_at, reps, lapses, state, last_review_at")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    stability: data.stability,
    difficulty: data.difficulty,
    dueAt: data.due_at,
    reps: data.reps,
    lapses: data.lapses,
    state: data.state,
    lastReviewAt: data.last_review_at,
  };
}

/** The one entry point session UIs call to load today's session — orchestrates settings, the length governor, start_session, get_session_queue, and card hydration. */
export async function buildTodaysSession(
  client: TypedClient,
  input: { userId: string; localDate: string; now: Date }
): Promise<BuiltSession> {
  const [settings, recentElapsedMs, totalDueCount, session] = await Promise.all([
    loadSessionSettings(client, input.userId),
    loadRecentElapsedMs(client, input.userId),
    countDueCards(client, input.userId, input.now),
    startTodaysSession(client, input.localDate),
  ]);

  const medianMs = computeMedianElapsedMs(recentElapsedMs);
  const capacity = estimateSessionCapacity(settings.sessionTargetMinutes, medianMs);
  const limits = allocateQueueLimits(capacity, totalDueCount, settings.dailyNewLimit);

  const entries = await fetchQueueEntries(client, limits);
  const hydrated = await hydrateQueueCards(client, entries);
  const plan = groupQueueIntoPlan(hydrated);

  const dueIncluded = entries.filter((e) => e.reason === "due" || e.reason === "warm_up").length;
  const overflowDueCount = Math.max(0, totalDueCount - dueIncluded);

  return { session, plan, settings, overflowDueCount };
}

export interface SubmitCardReviewInput {
  currentState: DbCardState | null;
  cardId: string;
  sessionId: string;
  rating: 1 | 2 | 3 | 4;
  elapsedMs: number;
  /** An empty string is a legitimate, honest "I don't know" attempt — never blocked. */
  answeredText: string;
  aiFeedback: string | null;
  aiSuggestedRating: 1 | 2 | 3 | 4 | null;
  /** The calibration tap, captured BEFORE reveal (085). Optional — omitting it is fully safe and lands `null`, never required. */
  confidence: "sure" | "think_so" | "guessing" | null;
  now: Date;
}

export interface SubmittedReview {
  reviewId: string;
  scheduledDays: number;
}

/** Computes the next FSRS state and submits it through submit_review, which re-validates the transition server-side before writing the review row and the card state in one transaction. Never writes card_states directly. */
export async function submitCardReview(client: TypedClient, input: SubmitCardReviewInput): Promise<SubmittedReview> {
  const scheduler = getScheduler();
  const current = toFsrsCard(input.currentState, input.now);
  const { card: nextCard, scheduledDays } = computeNextState(scheduler, current, input.rating, input.now);
  const nextState = toRpcNextState(nextCard);

  const { data, error } = await client.rpc("submit_review", {
    p_card_id: input.cardId,
    p_session_id: input.sessionId,
    p_rating: input.rating,
    p_elapsed_ms: input.elapsedMs,
    p_answered_text: input.answeredText,
    p_ai_feedback: input.aiFeedback as unknown as string,
    p_ai_suggested_rating: input.aiSuggestedRating as unknown as number,
    p_next_state: nextState as unknown as never,
    p_confidence: input.confidence ?? undefined,
  });
  if (error) throw error;

  return { reviewId: data!.id, scheduledDays };
}

/** Calls complete_session, which recomputes streak/freeze state server-side and is idempotent — safe to call twice (e.g. a flaky retry) without double-counting the streak. */
export async function completeTodaysSession(client: TypedClient, sessionId: string): Promise<SessionCompletionResult> {
  const { data, error } = await client.rpc("complete_session", { p_session_id: sessionId });
  if (error) throw error;
  const result = data as unknown as {
    current_streak: number;
    longest_streak: number;
    freezes_available: number;
    total_reviews: number;
    total_sessions: number;
    freeze_consumed?: FreezeConsumed | null;
    effortful_win?: EffortfulWinMoment | null;
  };
  return {
    currentStreak: result.current_streak,
    longestStreak: result.longest_streak,
    freezesAvailable: result.freezes_available,
    totalReviews: result.total_reviews,
    totalSessions: result.total_sessions,
    freezeConsumed: result.freeze_consumed ?? null,
    effortfulWin: result.effortful_win ?? null,
  };
}

/**
 * The server-side authoritative count of cards graded in this session.
 * Never derive this from a client-local counter — that resets to 0 on any
 * app relaunch mid-session, so a session graded 3 cards, relaunched, then
 * graded 5 more would show "5 cards reviewed" on screen while the database
 * has 8. `work_sessions.cards_reviewed` increments server-side on every
 * graded card (submit_review) and therefore survives relaunch for free.
 */
export async function fetchSessionCardsReviewed(client: TypedClient, sessionId: string): Promise<number> {
  const { data, error } = await client.from("work_sessions").select("cards_reviewed").eq("id", sessionId).single();
  if (error) throw error;
  return data.cards_reviewed ?? 0;
}

/** Self-explanation interstitials: ungraded by design, insert-only. `response: null` records a skip, which carries no penalty and is exactly as valid a row as an answered one. */
export async function submitSelfExplanation(
  client: TypedClient,
  input: { userId: string; lessonId: string; sessionId: string; prompt: string; response: string | null }
): Promise<void> {
  const { error } = await client.from("self_explanations").insert({
    // Required by the generated Insert type; overwritten unconditionally by
    // the self_explanations_set_user_id trigger (073) regardless of what's
    // passed, so a caller-supplied value here is never trusted.
    user_id: input.userId,
    lesson_id: input.lessonId,
    session_id: input.sessionId,
    prompt: input.prompt,
    response: input.response,
  });
  if (error) throw error;
}
