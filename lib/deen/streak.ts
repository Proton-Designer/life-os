/**
 * Consecutive-day Qur'an reading streak, hard reset on a missed day (no
 * freeze mechanic for v1, per spec). `sessionDates` are YYYY-MM-DD strings
 * (one or more per day is fine — only distinct days matter).
 */
export function computeQuranStreak(sessionDates: string[], todayStr: string): number {
  const days = new Set(sessionDates);
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
