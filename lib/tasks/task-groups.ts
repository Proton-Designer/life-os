export type TaskGroupKey = "week" | "next30" | "future";

export const TASK_GROUP_ORDER: TaskGroupKey[] = ["week", "next30", "future"];

export const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = {
  week: "This Week",
  next30: "Next Month",
  future: "Future",
};

/** How far ahead "Next Month" reaches — rolling days from today, deliberately not a calendar month. */
export const NEXT_MONTH_WINDOW_DAYS = 30;

/**
 * Which group a due date falls into (revised 2026-09-10 on Ayman's
 * instruction). `todayStr`/`tomorrowStr`/`weekDates`/`horizonStr` are
 * already-resolved local calendar strings from the caller (page.tsx's own
 * `localDateString(now, timezone)` + `weekDatesFrom` + `addDaysToDateString`),
 * so this stays a pure string-comparison function with no `Date`/timezone
 * logic of its own to get wrong — see AGENTS.md on deriving a calendar date
 * from an instant.
 *
 * WHAT CHANGED AND WHY:
 *
 * "Today" is gone as a top-level group. It is now the "Due Soon" subsection
 * INSIDE This Week (`splitDueSoon` below), so the default view is one list
 * of the whole week with the urgent end of it called out at the top, rather
 * than today and the rest of the week reading as unrelated buckets.
 *
 * TOMORROW IS ALWAYS IN `week`, even when tomorrow belongs to next week.
 * Ayman's rule for Due Soon is "anything due today or tomorrow", full stop —
 * so on a Saturday, Sunday's task is pulled up into This Week rather than
 * being correct-by-the-calendar and useless. The bucket exists to answer
 * "what is about to hit me", and a week boundary does not change that answer.
 *
 * "This Month" became "Next Month" and is a ROLLING 30-day window, not a
 * calendar month — the old YYYY-MM prefix match made the group shrink to
 * nothing by month's end, which is exactly when the next month's work
 * matters most.
 *
 * THE WINDOW HAS NO LOWER BOUND, AND THAT IS DELIBERATE. `dueDate <=
 * horizonStr` admits overdue work that predates this week, so a task missed
 * three weeks ago still surfaces here instead of falling through to
 * "Future", where nothing overdue would ever be looked for. This is not a
 * regression from the old behaviour: a stale task from a previous calendar
 * month already failed the old prefix match and landed in "Future" too —
 * this strictly improves on it. Overdue work inside the current week keeps
 * landing in `week`, as before.
 */
export function bucketTaskGroup(
  dueDate: string | null,
  todayStr: string,
  tomorrowStr: string,
  weekDates: string[],
  horizonStr: string
): TaskGroupKey {
  if (dueDate === null) return "future";
  if (dueDate === todayStr || dueDate === tomorrowStr) return "week";
  if (weekDates.includes(dueDate)) return "week";
  if (dueDate <= horizonStr) return "next30";
  return "future";
}

/** Groups tasks into the three buckets, each sorted soonest-first (Ayman: "the sooner a task is the more up it should be placed") — a null due date sorts last within its bucket. */
export function groupTasksByBucket<T extends { dueDate: string | null }>(
  tasks: T[],
  todayStr: string,
  tomorrowStr: string,
  weekDates: string[],
  horizonStr: string
): Record<TaskGroupKey, T[]> {
  const groups: Record<TaskGroupKey, T[]> = { week: [], next30: [], future: [] };
  for (const task of tasks) {
    groups[bucketTaskGroup(task.dueDate, todayStr, tomorrowStr, weekDates, horizonStr)].push(task);
  }
  for (const key of TASK_GROUP_ORDER) {
    groups[key].sort(compareByDueDate);
  }
  return groups;
}

/**
 * Splits This Week into its "Due Soon" head (due today or tomorrow) and the
 * rest of the week. Both halves keep the soonest-first order they arrived
 * in. Overdue work inside this week stays in `rest` rather than being
 * promoted — Due Soon means "about to be due", and quietly widening it to
 * "and also everything you already missed" would make the one auto-expanded
 * section the biggest one on the screen.
 */
export function splitDueSoon<T extends { dueDate: string | null }>(
  weekTasks: T[],
  todayStr: string,
  tomorrowStr: string
): { dueSoon: T[]; rest: T[] } {
  const dueSoon: T[] = [];
  const rest: T[] = [];
  for (const task of weekTasks) {
    if (task.dueDate === todayStr || task.dueDate === tomorrowStr) dueSoon.push(task);
    else rest.push(task);
  }
  return { dueSoon, rest };
}

function compareByDueDate<T extends { dueDate: string | null }>(a: T, b: T): number {
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}
