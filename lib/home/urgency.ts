// Client-safe (no server-only imports) so this can be shared between
// lib/home/get-priority-items.ts (server, initial SSR bucket) and
// components/home/priority-list.tsx (client, re-derives on a tick) — see
// PROJECT_STATUS.md's staleTimes follow-up for why both need the same logic.
export const RIGHT_NOW_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, per Task 4.2

export type UrgencyLevel = "right_now" | "later_today" | "absent";

/**
 * The sole urgency classifier (A2 wiring, R18(4)): a candidate with no
 * `dueAt` has NO urgency signal at all, not a default bucket -- "a
 * defaulting ranker input is the null-is-zero bug wearing a string" (Boss
 * ruling). Replaces the old two-state `urgencyBucket` function, which
 * defaulted a missing `dueAt` to `"later_today"` and has been retired
 * (deleted in the same commit that wires the arbiter into Home's live
 * "Now" module, per A2's own definition) — every caller (get-priority-
 * items.ts, next-actions.ts/tsx, priority-list.tsx) now goes through this
 * three-state classification instead.
 */
export function classifyUrgency(dueAt: Date | null, now: Date): UrgencyLevel {
  if (!dueAt) return "absent";
  return dueAt.getTime() - now.getTime() <= RIGHT_NOW_WINDOW_MS ? "right_now" : "later_today";
}
