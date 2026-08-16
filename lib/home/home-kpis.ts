/**
 * Cross-cutting completion across every domain due today — Home's KPI row
 * is deliberately never per-domain (row 3's domain status stack owns that),
 * per the one-metric rule.
 */
export function computeTodayCompletion({
  prayerStatuses,
  killList,
  tasks,
  hasScheduledWorkout,
  workoutDone,
}: {
  prayerStatuses: string[];
  killList: { completed: boolean }[];
  tasks: { completed: boolean }[];
  hasScheduledWorkout: boolean;
  workoutDone: boolean;
}): { done: number; total: number } {
  const prayersDone = prayerStatuses.filter((s) => s === "on_time" || s === "qada").length;
  const killListDone = killList.filter((k) => k.completed).length;
  const tasksDone = tasks.filter((t) => t.completed).length;

  const done = prayersDone + killListDone + tasksDone + (hasScheduledWorkout && workoutDone ? 1 : 0);
  const total = prayerStatuses.length + killList.length + tasks.length + (hasScheduledWorkout ? 1 : 0);

  return { done, total };
}
