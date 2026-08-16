import { computeTodayCompletion } from "./home-kpis";

export type DayCompletionInput = {
  prayerStatuses: string[];
  killList: { completed: boolean }[];
  tasks: { completed: boolean }[];
  hasScheduledWorkout: boolean;
  workoutDone: boolean;
};

/** One completion percent per day, in the given day order — for Home's 7-day trend chart. */
export function computeWeeklyCompletionPct(days: DayCompletionInput[]): number[] {
  return days.map((d) => {
    const { done, total } = computeTodayCompletion(d);
    return total === 0 ? 0 : Math.round((done / total) * 100);
  });
}
