// Client-safe (no server-only imports) so this can be shared between
// lib/home/get-priority-items.ts (server, initial SSR bucket) and
// components/home/priority-list.tsx (client, re-derives on a tick) — see
// PROJECT_STATUS.md's staleTimes follow-up for why both need the same logic.
export const RIGHT_NOW_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, per Task 4.2

export function urgencyBucket(dueAt: Date | null, now: Date): "right_now" | "later_today" {
  if (!dueAt) return "later_today";
  return dueAt.getTime() - now.getTime() <= RIGHT_NOW_WINDOW_MS ? "right_now" : "later_today";
}

export type UrgencyLevel = "right_now" | "later_today" | "absent";

/**
 * The corrected three-state classification for the cross-domain arbiter
 * (lib/home/arbiter.ts, R18(4)): a candidate with no `dueAt` has NO urgency
 * signal at all, not a default bucket -- "a defaulting ranker input is the
 * null-is-zero bug wearing a string" (Boss ruling). `urgencyBucket` above
 * still returns the old two-state shape and stays wired into the existing
 * Home "Now" module unchanged -- retrofitting every current caller
 * (next-actions.ts, priority-list.tsx, get-priority-items.ts) to this
 * three-state semantics is real, separate work with its own blast radius
 * on already-shipped UI, sequenced after the arbiter itself is proven, not
 * smuggled in here.
 */
export function classifyUrgency(dueAt: Date | null, now: Date): UrgencyLevel {
  if (!dueAt) return "absent";
  return dueAt.getTime() - now.getTime() <= RIGHT_NOW_WINDOW_MS ? "right_now" : "later_today";
}
