/** Open tasks whose due date has already passed — the "Overdue" KPI. */
export function countOverdue(tasks: { dueDate: string | null; completed: boolean }[], todayStr: string): number {
  return tasks.filter((t) => t.dueDate !== null && t.dueDate < todayStr).length;
}

/**
 * Tasks whose completed_at falls within [weekStartIso, weekEndIso) — the
 * "Completed this week" KPI. weekEndIso is exclusive, matching the same
 * half-open convention as bucketSignalNoiseByWeek.
 */
export function countCompletedInWeek(
  tasks: { completedAt: string | null }[],
  weekStartIso: string,
  weekEndIso: string
): number {
  return tasks.filter((t) => t.completedAt !== null && t.completedAt >= weekStartIso && t.completedAt < weekEndIso)
    .length;
}
