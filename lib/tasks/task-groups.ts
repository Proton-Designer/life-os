export type TaskGroupKey = "today" | "week" | "month" | "future";

export const TASK_GROUP_ORDER: TaskGroupKey[] = ["today", "week", "month", "future"];

export const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  future: "Future",
};

/**
 * Which of Ayman's four groups a due date falls into (item 5, 2026-08-26
 * night batch 2) — `todayStr`/`weekDates` are already-resolved local
 * calendar strings from the caller (page.tsx's own `localDateString(now,
 * timezone)` + `weekDatesFrom`), so this stays a pure string-comparison
 * function with no `Date`/timezone logic of its own to get wrong.
 * "This Month" is same calendar month as today (YYYY-MM prefix match,
 * regardless of before/after today within it — an overdue task earlier
 * this month lands here, not in a separate "overdue" bucket, since Ayman's
 * four groups don't name one); "Future" is literally "anything beyond"
 * the other three, including a null due date.
 */
export function bucketTaskGroup(dueDate: string | null, todayStr: string, weekDates: string[]): TaskGroupKey {
  if (dueDate === null) return "future";
  if (dueDate === todayStr) return "today";
  if (weekDates.includes(dueDate)) return "week";
  if (dueDate.slice(0, 7) === todayStr.slice(0, 7)) return "month";
  return "future";
}

/** Groups tasks into the four buckets, each sorted soonest-first (Ayman: "the sooner a task is the more up it should be placed") — a null due date sorts last within its bucket. */
export function groupTasksByBucket<T extends { dueDate: string | null }>(
  tasks: T[],
  todayStr: string,
  weekDates: string[]
): Record<TaskGroupKey, T[]> {
  const groups: Record<TaskGroupKey, T[]> = { today: [], week: [], month: [], future: [] };
  for (const task of tasks) {
    groups[bucketTaskGroup(task.dueDate, todayStr, weekDates)].push(task);
  }
  for (const key of TASK_GROUP_ORDER) {
    groups[key].sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  }
  return groups;
}
