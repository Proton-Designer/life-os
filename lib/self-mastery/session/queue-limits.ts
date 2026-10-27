// Session-length governor — ported from ULM's packages/core/src/session/index.ts.
// Decides how many due/new cards to ASK the RPC for; the interleaving,
// warm-up selection, and soft-delete filtering all live in get_session_queue
// itself (071) and are never reimplemented here.

/** The most a session may run, even under exam intensity: ~2x the spec's "5-10 minutes, completable every day". Also the top of the Settings range for session length. */
export const MAX_SESSION_MINUTES_WITH_INTENSITY = 20;

/** Seed used before the user has any review history. */
export const SEED_MS_PER_CARD = 20_000;

/** Median of up to the last 50 reviews' `elapsed_ms`, seeded at 20s with no history. */
export function computeMedianElapsedMs(recentElapsedMs: number[]): number {
  if (recentElapsedMs.length === 0) return SEED_MS_PER_CARD;
  const sorted = [...recentElapsedMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? SEED_MS_PER_CARD);
  return median > 0 ? median : SEED_MS_PER_CARD;
}

/** How many cards fit in `targetMinutes` at `medianMsPerCard` per card. Always >= 1 — a session that can't fit even one card at the user's own settings is a settings problem, not a reason to show an empty queue. */
export function estimateSessionCapacity(targetMinutes: number, medianMsPerCard: number): number {
  const capacity = Math.floor((targetMinutes * 60_000) / medianMsPerCard);
  return Math.max(1, capacity);
}

export interface QueueLimits {
  limitDue: number;
  limitNew: number;
}

/** `daily_new_limit` is a per-DAY cap: what was already introduced on the local date comes off it. Never negative (the limit can be lowered mid-day, and an MCP-graded card counts too). */
export function remainingNewAllowance(dailyNewLimit: number, newIntroducedToday: number): number {
  return Math.max(0, dailyNewLimit - newIntroducedToday);
}

/** Splits total capacity between due and new cards: due first (up to `totalDueCount`, never more), new gets what's left, capped by the user's own `dailyNewLimit`. Excess due cards are simply not requested — they stay due, roll to tomorrow, nothing is "dropped". */
export function allocateQueueLimits(capacity: number, totalDueCount: number, dailyNewLimit: number): QueueLimits {
  const limitDue = Math.min(capacity, totalDueCount);
  const limitNew = Math.max(0, Math.min(dailyNewLimit, capacity - limitDue));
  return { limitDue, limitNew };
}

export interface SessionPreview {
  /** Due cards the session will take (the rest stay due and roll over). */
  sessionDue: number;
  /** New cards the session will take: what capacity has left after due, capped by `dailyNewLimit` and by how many exist. */
  sessionNew: number;
  dueWaiting: number;
  newWaiting: number;
  /** Today's new-card allowance is used up (and there are new cards still waiting): "done for today", not "none left". */
  allowanceSpent: boolean;
  /** Minutes the cards above take at the person's own median pace, rounded up; 0 when the session is empty. */
  minutes: number;
}

/**
 * What a session opened right now would hold, for Home's entry card -- the SAME capacity and allocation math
 * buildSession runs (estimateSessionCapacity, then allocateQueueLimits), minus exam intensity, which only ever lengthens
 * a session. Pure so the card's promise and the session's contents can't drift apart.
 */
export function previewSession(input: {
  dueCount: number;
  newCount: number;
  targetMinutes: number;
  dailyNewLimit: number;
  /** New cards already introduced on the person's local date (reviews whose state_before was 'new'). */
  newIntroducedToday: number;
  medianMs: number;
}): SessionPreview {
  const capacity = estimateSessionCapacity(input.targetMinutes, input.medianMs);
  const { limitDue, limitNew } = allocateQueueLimits(capacity, input.dueCount, remainingNewAllowance(input.dailyNewLimit, input.newIntroducedToday));
  const sessionNew = Math.min(limitNew, input.newCount);
  const cards = limitDue + sessionNew;
  return {
    sessionDue: limitDue,
    sessionNew,
    dueWaiting: input.dueCount - limitDue,
    newWaiting: input.newCount - sessionNew,
    allowanceSpent: input.newCount > 0 && input.newIntroducedToday > 0 && remainingNewAllowance(input.dailyNewLimit, input.newIntroducedToday) === 0,
    minutes: cards === 0 ? 0 : Math.ceil((cards * input.medianMs) / 60_000),
  };
}
