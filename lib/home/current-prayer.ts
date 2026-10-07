import type { PriorityItem } from "./types";

/**
 * The ONE prayer to show in Home's "Right now" strip: the pending prayer whose own window contains `now`
 * (`dueAt <= now < windowEndAt`). `getPriorityItems` only returns prayers that are still pending (a prayed prayer, or one
 * whose window closed, is not in the list), so "prayed" and "window over" both come out as null here. Never more than one:
 * if two windows ever overlapped, the one that opened last (the most current) wins. A prayer with no window (no location
 * set) can never be "current" -- there is no signal to say when it is.
 */
export function currentPrayer(items: readonly PriorityItem[], now: Date): PriorityItem | null {
  const t = now.getTime();
  let best: PriorityItem | null = null;
  for (const item of items) {
    if (item.actionType !== "toggle_prayer" || item.completed || !item.dueAt || !item.windowEndAt) continue;
    if (item.dueAt.getTime() <= t && t < item.windowEndAt.getTime()) {
      if (!best || item.dueAt.getTime() > best.dueAt!.getTime()) best = item;
    }
  }
  return best;
}
