export type ConsistencyHabit = { id: string; createdAt: string };
export type ConsistencyLog = { habitId: string; date: string; completed: boolean };

function addDaysIso(dateStr: string, delta: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Weekly habit consistency (0–1), only counting each habit's days from its
 * `createdAt` forward — adding a habit mid-week doesn't retroactively look
 * incomplete for days before it existed, per spec. `today` caps the range so
 * future days in the week aren't counted as missed either.
 */
export function calculateWeeklyConsistency(
  habits: ConsistencyHabit[],
  logs: ConsistencyLog[],
  weekStart: string,
  today: string
): number {
  let trackableDays = 0;
  let doneDays = 0;

  for (const habit of habits) {
    const rangeStart = habit.createdAt > weekStart ? habit.createdAt : weekStart;
    let cursor = rangeStart;
    while (cursor <= today) {
      trackableDays++;
      const log = logs.find((l) => l.habitId === habit.id && l.date === cursor);
      if (log?.completed) doneDays++;
      cursor = addDaysIso(cursor, 1);
    }
  }

  return trackableDays === 0 ? 0 : doneDays / trackableDays;
}
