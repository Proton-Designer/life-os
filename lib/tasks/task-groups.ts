export type TaskGroupKey = "overdue" | "week" | "next30" | "future";

/** RENDER order — deliberately does NOT include "overdue" (2026-09-10, Ayman:
 * overdue tasks must auto-remove from the Task list and surface only in the
 * School screen's own Overdue KPI card). `groupTasksByBucket` below still
 * returns an `overdue` bucket — it is a real, populated, sorted key, just one
 * `TaskListModule` never iterates — so the omission from the list is a
 * visible, testable decision rather than a task silently vanishing between a
 * filter and a render loop. */
export const TASK_GROUP_ORDER: TaskGroupKey[] = ["week", "next30", "future"];

export const TASK_GROUP_LABEL: Record<TaskGroupKey, string> = {
  overdue: "Overdue",
  week: "This Week",
  next30: "Next Month",
  future: "Future",
};

/** How far ahead "Next Month" reaches — rolling days from today, deliberately not a calendar month. */
export const NEXT_MONTH_WINDOW_DAYS = 30;

/**
 * Which group a due date falls into (revised 2026-09-10, twice in one day:
 * first for This Week/Due Soon/Next Month, then again on Ayman's instruction
 * — "overdue items still remain present in the task list, make sure that
 * they are auto removed and just show in the overdue section" — to carve
 * `overdue` out as its own bucket). `todayStr`/`tomorrowStr`/`weekDates`/
 * `horizonStr` are already-resolved local calendar strings from the caller
 * (page.tsx's own `localDateString(now, timezone)` + `weekDatesFrom` +
 * `addDaysToDateString`), so this stays a pure string-comparison function
 * with no `Date`/timezone logic of its own to get wrong — see AGENTS.md on
 * deriving a calendar date from an instant.
 *
 * WHAT CHANGED AND WHY:
 *
 * OVERDUE IS EXTRACTED FIRST, before every other branch, and is never
 * rendered by `TaskListModule` (see `TASK_GROUP_ORDER`'s own comment) — it
 * surfaces only through the School screen's Overdue KPI card, whose
 * `overdueItems` filter (`dueDate !== null && dueDate < dateStr`,
 * app/(app)/school/page.tsx) this branch is written to match exactly. Tested
 * directly: `bucketTaskGroup`'s overdue branch and `overdueItems`'s filter
 * must never disagree about which tasks are overdue.
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
 * Tomorrow is never overdue (it is always strictly after today), so this
 * rule is untouched by the overdue extraction above it.
 *
 * `week` NOW MEANS "TODAY THROUGH SATURDAY" IN PRACTICE, NOT "SUN-SAT".
 * `weekDates` is still the full Sun-Sat range handed down by the caller, and
 * `weekDates.includes(dueDate)` below is unchanged — but any day in that
 * range earlier than today is now caught by the overdue branch first and
 * never reaches this check. Before this revision, an earlier-this-week task
 * (Sunday or Monday, say, when today is Tuesday) landed in `week`; now it
 * leaves before `week` is even consulted.
 *
 * "This Month" became "Next Month" and is a ROLLING 30-day window, not a
 * calendar month — the old YYYY-MM prefix match made the group shrink to
 * nothing by month's end, which is exactly when the next month's work
 * matters most.
 *
 * THE WINDOW'S LOWER BOUND IS NOW IMPLICIT, NOT ABSENT. This paragraph used
 * to say `next30` has no lower bound "specifically so overdue work surfaces
 * there instead of falling through to Future" — that reasoning is dead as of
 * this revision: overdue work leaves at the top of this function now, before
 * `next30`'s own `dueDate <= horizonStr` check is ever reached, so nothing
 * overdue can land in `next30` by construction, not by an unbounded
 * comparison. `next30` means strictly "beyond this week, within 30 days" —
 * every date it admits is already known to be `> todayStr` by the time it's
 * checked. Leaving the old paragraph in place would have made it a claim
 * about why the code is shaped the way it is that the code no longer
 * supports — the exact failure mode `removeClassEvent`'s stale comment
 * produced (AGENTS.md, R80/`19975b2`-era note): a comment nobody re-read
 * once the code beneath it changed.
 */
export function bucketTaskGroup(
  dueDate: string | null,
  todayStr: string,
  tomorrowStr: string,
  weekDates: string[],
  horizonStr: string
): TaskGroupKey {
  if (dueDate === null) return "future";
  if (dueDate < todayStr) return "overdue";
  if (dueDate === todayStr || dueDate === tomorrowStr) return "week";
  if (weekDates.includes(dueDate)) return "week";
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
  tomorrowStr: string,
  weekDates: string[],
  horizonStr: string
): Record<TaskGroupKey, T[]> {
  const groups: Record<TaskGroupKey, T[]> = { overdue: [], week: [], next30: [], future: [] };
  for (const task of tasks) {
    groups[bucketTaskGroup(task.dueDate, todayStr, tomorrowStr, weekDates, horizonStr)].push(task);
  }
  for (const key of Object.keys(groups) as TaskGroupKey[]) {
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
