// Client-safe (no server-only imports) so this can be shared between
// lib/home/get-priority-items.ts (server, initial SSR bucket) and
// components/home/priority-list.tsx (client, re-derives on a tick) — see
// PROJECT_STATUS.md's staleTimes follow-up for why both need the same logic.
export const RIGHT_NOW_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours, per Task 4.2

export function urgencyBucket(dueAt: Date | null, now: Date): "right_now" | "later_today" {
  if (!dueAt) return "later_today";
  return dueAt.getTime() - now.getTime() <= RIGHT_NOW_WINDOW_MS ? "right_now" : "later_today";
}
