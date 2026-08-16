/** How many distinct days in `rows` had every kill-list item completed — the caller pre-windows the rows (e.g. last 7 days). */
export function countDaysCleared(rows: { date: string; completed: boolean }[]): number {
  const byDate = new Map<string, boolean[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r.completed);
    byDate.set(r.date, list);
  }
  let cleared = 0;
  for (const completions of byDate.values()) {
    if (completions.length > 0 && completions.every(Boolean)) cleared++;
  }
  return cleared;
}
