import type { PriorityItem } from "@/lib/home/types";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { formatWindowRelativeTime } from "@/lib/date-utils";

/**
 * Home's priority rows (tasks, Kill List lines): how a PriorityItem becomes a TaskRowItem, and the small "Today" / "in 2h" /
 * "Now" text on its right. Pure; shared by the unified Today list.
 */

/** The single most urgent item among those shown: right_now bucket, earliest dueAt. */
export function mostUrgentId(items: readonly PriorityItem[]): string | null {
  const candidates = items.filter((i) => i.urgencyBucket === "right_now");
  if (candidates.length === 0) return null;
  const earliest = candidates.reduce((best, i) => {
    const bestTime = best.dueAt?.getTime() ?? Infinity;
    const time = i.dueAt?.getTime() ?? Infinity;
    return time < bestTime ? i : best;
  });
  return earliest.id;
}

// "Now · in 2h" would be redundant with itself when the window's own time text already reads "Now": collapse to "Now".
export function metaFor(item: PriorityItem, now: Date, isMostUrgent: boolean): string {
  const timeText = formatWindowRelativeTime(item.dueAt, item.windowEndAt, now);
  if (isMostUrgent && timeText !== "Now") return `Now · ${timeText}`;
  return timeText;
}

/** `rowId` is the Today list's unique row id (see lib/home/today-list.ts), which is what the list's bookkeeping is keyed by. */
export function toTaskRowItem(item: PriorityItem, rowId: string, now: Date, isMostUrgent: boolean): TaskRowItem {
  return {
    id: rowId,
    title: item.title,
    domain: item.domain,
    meta: metaFor(item, now, isMostUrgent),
    mode: "toggle",
    // Tasks and kill-list items can be pushed to tomorrow; prayers/adhkar/habits are tied to their own day or window.
    canDelay: item.actionType === "toggle_task" || item.actionType === "toggle_kill_list",
  };
}
