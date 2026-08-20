/**
 * Pure helpers for the Co-op Weekly Agenda + pipeline board — no React,
 * no I/O. docs/superpowers/specs/2026-08-20-coop-redesign.md.
 *
 * Agenda and pipeline are ONE set of rows, not two (Opus Lead ruling 1):
 * the Agenda is a creation-and-list surface, the pipeline is a status
 * view over the same task rows. "Automatically placed in Backlog" is
 * just the status column defaulting to `backlog` — there is no separate
 * write path.
 */

export type CoopTaskStatus = "backlog" | "in_progress" | "review" | "complete" | "blocked";

export type CoopTaskRow = {
  id: string;
  title: string;
  deadline: string | null;
  status: CoopTaskStatus;
  /** Only meaningful while status === "blocked" — where to restore on unblock (ruling 2). */
  blockedFrom: Exclude<CoopTaskStatus, "blocked"> | null;
  createdAt: string;
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
