export type TaskGroupKey = "overdue" | "dueSoon" | "next30" | "future";

/** RENDER order — deliberately does NOT include "overdue" (2026-09-10, Ayman:
 * overdue tasks must auto-remove from the Task list and surface only in the
 * School screen's own Overdue KPI card). `groupTasksByBucket` below still
 * returns an `overdue` bucket — it is a real, populated, sorted key, just one
 * `TaskListModule` never iterates — so the omission from the list is a
 * visible, testable decision rather than a task silently vanishing between a
 * filter and a render loop. */
export const TASK_GROUP_ORDER: TaskGroupKey[] = ["dueSoon", "next30", "future"];

export const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = {
  overdue: "Overdue",
  dueSoon: "Due Soon",
  next30: "Upcoming",
  future: "Future",
};

/** How far ahead "Upcoming" reaches — rolling days from today, beyond the two-week Due Soon range, deliberately not a calendar month. */
export const UPCOMING_WINDOW_DAYS = 30;

/**
 * Which group a due date falls into (revised 2026-09-10 batch 2, Ayman:
 * "change This Week default time range to Due Soon and this should display
 * the tasks for the next 2 weeks instead of 1 week" — the group that used to
 * be "This Week" now spans this calendar week AND next calendar week).
 * `todayStr`/`weekDates`/`nextWeekDates`/`horizonStr` are already-resolved
 * local calendar strings from the caller (page.tsx's own
 * `localDateString(now, timezone)` + `weekDatesFrom` + `addDaysToDateString`),
 * so this stays a pure string-comparison function with no `Date`/timezone
 * logic of its own to get wrong — see AGENTS.md on deriving a calendar date
 * from an instant.
 *
 * OVERDUE IS EXTRACTED FIRST, before every other branch, and is never
 * rendered by `TaskListModule` (see `TASK_GROUP_ORDER`'s own comment) — it
 * surfaces only through the School screen's Overdue KPI card, whose
 * `overdueItems` filter (`dueDate !== null && dueDate < dateStr`,
 * app/(app)/school/page.tsx) this branch is written to match exactly.
 *
 * NO SEPARATE "TOMORROW" RULE ANYMORE. The old `week` bucket special-cased
 * tomorrow so it was never pushed out by a Sun-Sat boundary crossing (a
 * Saturday's "tomorrow" is next week's Sunday). That special case is now
 * structurally unnecessary: `dueSoon` spans BOTH `weekDates` and
 * `nextWeekDates`, and next week's Sunday is, by definition, `nextWeekDates`'
 * own first day. Removing dead special-casing here isn't cosmetic — a
 * `tomorrowStr` rule nobody needs anymore is exactly the kind of comment that
 * outlives the reasoning behind it (see the `removeClassEvent` incident,
 * AGENTS.md).
 *
 * "Upcoming" (was "Next Month") is a ROLLING 30-day window starting after the
 * two-week Due Soon range, not a calendar month — the old YYYY-MM prefix
 * match made the group shrink to nothing by month's end, which is exactly
 * when the next month's work matters most. Its lower bound is implicit, not
 * absent: overdue work leaves at the top of this function, and everything in
 * `weekDates`/`nextWeekDates` leaves before this branch is reached, so
 * `next30` only ever admits a date already known to be `> todayStr` and
 * outside both weeks — by construction, not by an unbounded comparison.
 */
export function bucketTaskGroup(
  dueDate: string | null,
  todayStr: string,
  weekDates: string[],
  nextWeekDates: string[],
  horizonStr: string
): TaskGroupKey {
  if (dueDate === null) return "future";
  if (dueDate < todayStr) return "overdue";
  if (weekDates.includes(dueDate)) return "dueSoon";
  if (nextWeekDates.includes(dueDate)) return "dueSoon";
  if (dueDate <= horizonStr) return "next30";
  return "future";
}

/**
 * Groups tasks into all FOUR buckets — `overdue` included, even though
 * `TaskListModule` never renders it (see `TASK_GROUP_ORDER`) — each sorted
 * soonest-first (Ayman: "the sooner a task is the more up it should be
 * placed"), a null due date sorting last within its bucket. Sorting every
 * key, not just the ones in `TASK_GROUP_ORDER`, is deliberate: a caller that
 * does read `groups.overdue` directly (the School KPI card doesn't today —
 * it has its own `overdueItems` — but nothing stops a future one) gets the
 * same soonest-first guarantee as every other bucket, not an unspecified
 * order nobody promised.
 *
 * TOTAL BY CONSTRUCTION: every input task is pushed into exactly one bucket
 * by `bucketTaskGroup`, which always returns one of the four keys — there is
 * no filter step that can silently drop a task before it is ever bucketed.
 * `__tests__/task-groups.test.ts` asserts this directly (the union of all
 * four buckets has the same ids as the input), so a future edit that adds a
 * pre-filter cannot regress it without a test noticing.
 */
export function groupTasksByBucket<T extends { dueDate: string | null }>(
  tasks: T[],
  todayStr: string,
  weekDates: string[],
  nextWeekDates: string[],
  horizonStr: string
): Record<TaskGroupKey, T[]> {
  const groups: Record<TaskGroupKey, T[]> = { overdue: [], dueSoon: [], next30: [], future: [] };
  for (const task of tasks) {
    groups[bucketTaskGroup(task.dueDate, todayStr, weekDates, nextWeekDates, horizonStr)].push(task);
  }
  for (const key of Object.keys(groups) as TaskGroupKey[]) {
    groups[key].sort(compareByDueDate);
  }
  return groups;
}

/**
 * Splits the Due Soon bucket into its "This week" head and "Next week" tail
 * (2026-09-10 batch 2, Ayman: replaces the old today/tomorrow "Due Soon"
 * subsection with a clean this-week/next-week split, in that order, top to
 * bottom). `weekDates` is enough to draw the line: `groupTasksByBucket`
 * already guarantees every task handed to this function is in `weekDates` OR
 * `nextWeekDates` (that's the only way into the `dueSoon` bucket), so
 * "not in weekDates" and "in nextWeekDates" are the same set here — this
 * function only needs the one array, not both. Both halves keep the
 * soonest-first order they arrived in.
 */
export function splitByWeek<T extends { dueDate: string | null }>(
  dueSoonTasks: T[],
  weekDates: string[]
): { thisWeek: T[]; nextWeek: T[] } {
  const thisWeek: T[] = [];
  const nextWeek: T[] = [];
  for (const task of dueSoonTasks) {
    if (task.dueDate !== null && weekDates.includes(task.dueDate)) thisWeek.push(task);
    else nextWeek.push(task);
  }
  return { thisWeek, nextWeek };
}

function compareByDueDate<T extends { dueDate: string | null }>(a: T, b: T): number {
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}
