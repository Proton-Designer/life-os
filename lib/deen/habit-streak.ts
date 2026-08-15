/**
 * Consecutive completed-day streak for a Habit Builder habit, walking back
 * from today through deen_habit_logs — hard reset on a missed day (same
 * "no freeze mechanic" rule as lib/deen/streak.ts's Qur'an streak).
 * Informational alongside stage, per the design spec — does NOT gate
 * promotion between stages (see habit-stage.ts).
 */
export function computeHabitStreak(completedDates: string[], todayStr: string): number {
  const days = new Set(completedDates);
  if (days.size === 0) return 0;

  let cursor = new Date(`${todayStr}T00:00:00Z`);
  if (!days.has(todayStr)) {
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  while (days.has(isoDate(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function addDays(date: Date, delta: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
