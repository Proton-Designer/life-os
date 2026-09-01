// Shared shapes for the retrieval session — ported/adapted from ULM's
// packages/core/src/session/index.ts.

export type PromptType = "free_recall" | "application" | "cloze" | "why";

export type QueueReason = "warm_up" | "due" | "new";

/** Raw row from `get_session_queue`. */
export interface QueueEntry {
  cardId: string;
  bookId: string;
  queuePosition: number;
  reason: QueueReason;
}

/**
 * A card ready to display. Deliberately has NO `answer` field — this is the
 * non-negotiable invariant (session-screen-spec.md §1.1): every query that
 * produces a SessionCard selects prompt and never answer. `fetchCardAnswer`
 * is the one function that reads `answer`, and it exists to be called only
 * at reveal time, one card at a time, never as part of a batch queue fetch.
 */
export interface SessionCard {
  id: string;
  lessonId: string;
  bookId: string;
  promptType: PromptType;
  prompt: string;
  reason: QueueReason;
  queuePosition: number;
}

export interface SessionPlan {
  warmUp: SessionCard[];
  due: SessionCard[];
  fresh: SessionCard[];
  /** One application-type prompt pulled from the due/fresh sets to close the session. `null` when nothing in today's queue is an application prompt — never fabricated. */
  closer: SessionCard | null;
}

export interface SessionSettings {
  sessionTargetMinutes: number;
  dailyNewLimit: number;
  aiGradingEnabled: boolean;
  desiredRetention: number;
}

/** `work_sessions` row, narrowed to the `kind: 'learn'` shape. */
export interface RawSession {
  id: string;
  userId: string;
  localDate: string;
  startedAt: string;
  endedAt: string | null;
  cardsReviewed: number;
  newCardsIntroduced: number;
}

export interface BuiltSession {
  session: RawSession;
  plan: SessionPlan;
  settings: SessionSettings;
  /** Due cards that exist but didn't fit this session's time budget — they remain due for tomorrow untouched, never silently dropped. */
  overflowDueCount: number;
}

/** A freeze auto-consumed a gap covering this `complete_session` call. Present only on the call where consumption actually happened. */
export interface FreezeConsumed {
  count: number;
  freezesRemaining: number;
}

/** At most one per session, highest-value-first. Each variant carries exactly what its card needs to render — no follow-up fetch. `book_milestone` and `personal_best` are not emitted by complete_session today (see 079's header comment) but are included here so the type is ready the day they land, without a client change. */
export type EffortfulWinMoment =
  | { kind: "recovered_card"; cardId: string; lessonId: string; prompt: string }
  | { kind: "comeback"; gapDays: number }
  | { kind: "book_milestone"; bookId: string; bookTitle: string; strength: number }
  | { kind: "hard_won_recall"; cardId: string; lessonId: string; prompt: string; elapsedMs: number }
  | { kind: "deck_complete"; bookId: string; bookTitle: string };

export interface SessionCompletionResult {
  currentStreak: number;
  longestStreak: number;
  freezesAvailable: number;
  totalReviews: number;
  totalSessions: number;
  freezeConsumed: FreezeConsumed | null;
  effortfulWin: EffortfulWinMoment | null;
}
