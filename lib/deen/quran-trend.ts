/** Sums pages_read per day, in the given `days` order — for the Qur'an trend chart. */
export function bucketPagesByDay(sessions: { date: string; pages_read: number }[], days: string[]): number[] {
  return days.map((day) => sessions.filter((s) => s.date === day).reduce((sum, s) => sum + s.pages_read, 0));
}
