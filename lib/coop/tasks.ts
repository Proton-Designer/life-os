/**
 * Pure helpers for the Work Weekly Agenda Pipeline — no React, no I/O.
 * docs/superpowers/specs/2026-08-20-coop-redesign.md.
 *
 * Agenda and pipeline are ONE set of rows, not two (Opus Lead ruling 1):
 * the Agenda's add-task form and the pipeline board's columns are two
 * views over the same task rows. "Automatically placed in Backlog" is
 * just the status column defaulting to `backlog` — there is no separate
 * write path.
 */

import { localDateString } from "@/lib/date-utils";

export type CoopTaskStatus = "backlog" | "in_progress" | "review" | "complete" | "blocked";

export type CoopTaskRow = {
  id: string;
  title: string;
  deadline: string | null;
  status: CoopTaskStatus;
  /** Only meaningful while status === "blocked" — where to restore on unblock (ruling 2). */
  blockedFrom: Exclude<CoopTaskStatus, "blocked"> | null;
  createdAt: string;
  /** When the task most recently entered `complete` (migration 055) — null
   * whenever status !== "complete". Drives the Past section boundary
   * below; never set from created_at (see the migration's backfill note). */
  completedAt: string | null;
};

/** The sequence a normal (non-blocked) task advances through. Blocked is deliberately absent — it's a detached pause, not a step (ruling 2), so it never appears in this ordered list. */
export const PIPELINE_STAGES: Exclude<CoopTaskStatus, "blocked">[] = ["backlog", "in_progress", "review", "complete"];

export function nextStage(status: Exclude<CoopTaskStatus, "blocked">): Exclude<CoopTaskStatus, "blocked"> | null {
  const i = PIPELINE_STAGES.indexOf(status);
  return i < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[i + 1] : null;
}

export function previousStage(status: Exclude<CoopTaskStatus, "blocked">): Exclude<CoopTaskStatus, "blocked"> | null {
  const i = PIPELINE_STAGES.indexOf(status);
  return i > 0 ? PIPELINE_STAGES[i - 1] : null;
}

/**
 * The Agenda's own scope (ruling 7): the current target's tasks that are
 * NOT complete, ordered by deadline (nulls last) then creation. Blocked
 * tasks stay in the Agenda — being blocked doesn't mean the work is done,
 * it means it's paused; only `complete` drops a task out.
 */
export function agendaTasks(tasks: CoopTaskRow[]): CoopTaskRow[] {
  return [...tasks]
    .filter((t) => t.status !== "complete")
    .sort((a, b) => {
      if (a.deadline === null && b.deadline === null) return a.createdAt.localeCompare(b.createdAt);
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      const byDeadline = a.deadline.localeCompare(b.deadline);
      return byDeadline !== 0 ? byDeadline : a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * Groups the non-blocked tasks by pipeline column. Blocked tasks are
 * deliberately excluded here — ruling 2's "detached, not a fifth column
 * in the sequence" means a blocked task is pulled OUT of the linear
 * column layout entirely (see blockedTasks below), not left inline with
 * a badge. It still remembers where it came from via blockedFrom, but
 * that's read only on unblock, never for where it renders while blocked.
 */
export function groupByStage(tasks: CoopTaskRow[]): Record<Exclude<CoopTaskStatus, "blocked">, CoopTaskRow[]> {
  const groups: Record<Exclude<CoopTaskStatus, "blocked">, CoopTaskRow[]> = {
    backlog: [],
    in_progress: [],
    review: [],
    complete: [],
  };
  for (const task of tasks) {
    if (task.status === "blocked") continue;
    groups[task.status].push(task);
  }
  return groups;
}

/** Every currently-blocked task, for the detached Blocked section. */
export function blockedTasks(tasks: CoopTaskRow[]): CoopTaskRow[] {
  return tasks.filter((t) => t.status === "blocked");
}

/** How long a completed task stays visible in the normal Complete column before sliding into Past (Ayman's spec, 2026-08-28 batch 5). */
export const PAST_COMPLETE_THRESHOLD_DAYS = 7;

/**
 * A completed task becomes "Past" once at least PAST_COMPLETE_THRESHOLD_DAYS
 * full calendar days have elapsed in the user's OWN timezone — never a raw
 * UTC day count. This is precisely the bug class AGENTS.md documents as
 * having shipped three times already: both `completedAt` and `now` are
 * converted to local calendar-date strings via `localDateString` in the
 * same timezone *before* being diffed, so a UTC-day rollover that hasn't
 * happened locally yet (or already has, east of UTC) can't shift the
 * count.
 */
export function isPastCompletedTask(completedAtIso: string, now: Date, timezone: string): boolean {
  const completedDateStr = localDateString(new Date(completedAtIso), timezone);
  const todayStr = localDateString(now, timezone);
  return calendarDaysBetween(completedDateStr, todayStr) >= PAST_COMPLETE_THRESHOLD_DAYS;
}

function calendarDaysBetween(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split("-").map(Number);
  const [ty, tm, td] = toDateStr.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Splits the current target's tasks into what the pipeline board itself
 * renders vs. what's aged out into the Past popup. A task only ever moves
 * into `past` from `complete` — every other status (including blocked)
 * stays in `pipeline` regardless of age.
 */
export function splitByPastComplete(
  tasks: CoopTaskRow[],
  now: Date,
  timezone: string
): { pipelineTasks: CoopTaskRow[]; pastTasks: CoopTaskRow[] } {
  const pastTasks = tasks.filter(
    (t) => t.status === "complete" && t.completedAt !== null && isPastCompletedTask(t.completedAt, now, timezone)
  );
  const pastIds = new Set(pastTasks.map((t) => t.id));
  const pipelineTasks = tasks.filter((t) => !pastIds.has(t.id));
  return { pipelineTasks, pastTasks };
}
