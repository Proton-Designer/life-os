// Session-length governor — ported from ULM's packages/core/src/session/index.ts.
// Decides how many due/new cards to ASK the RPC for; the interleaving,
// warm-up selection, and soft-delete filtering all live in get_session_queue
// itself (071) and are never reimplemented here.

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

/** Splits total capacity between due and new cards: due first (up to `totalDueCount`, never more), new gets what's left, capped by the user's own `dailyNewLimit`. Excess due cards are simply not requested — they stay due, roll to tomorrow, nothing is "dropped". */
export function allocateQueueLimits(capacity: number, totalDueCount: number, dailyNewLimit: number): QueueLimits {
  const limitDue = Math.min(capacity, totalDueCount);
  const limitNew = Math.max(0, Math.min(dailyNewLimit, capacity - limitDue));
  return { limitDue, limitNew };
}
