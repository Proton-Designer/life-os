export type HabitConsistencyInput = { id: string; name: string; committedDate: string };
export type HabitLogInput = { habitId: string; date: string; completed: boolean };

function addDaysIso(dateStr: string, delta: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Rolling completion count over [windowStart, today], floored at the
 * habit's own committed_date so a habit started mid-window doesn't get
 * penalized for days before it existed — same pattern as
 * lib/fitness/consistency.ts's calculateWeeklyConsistency. Headline number
 * for the redesigned Habit Builder (see
 * docs/superpowers/specs/2026-08-18-habit-builder-redesign-proposal.md §2):
 * "N of the last 30 days" instead of a hard-reset streak.
 *
 * Today is never counted as a miss — the day isn't over, so an unlogged
 * "today" is excluded from the denominator entirely rather than read as a
 * failure; a completed today adds to both done and total. Mirrors
 * computeHabitStreak's existing "skip today unless completed" convention:
 * today can only help the rate, never hurt it.
 */
export function computeHabitRollingRate(
  habit: HabitConsistencyInput,
  logs: HabitLogInput[],
  windowStart: string,
  today: string
): { done: number; total: number } {
  const rangeStart = habit.committedDate > windowStart ? habit.committedDate : windowStart;
  const yesterday = addDaysIso(today, -1);
  let done = 0;
  let total = 0;
  let cursor = rangeStart;
  while (cursor <= yesterday) {
    total++;
    if (logs.some((l) => l.habitId === habit.id && l.date === cursor && l.completed)) done++;
    cursor = addDaysIso(cursor, 1);
  }
  if (logs.some((l) => l.habitId === habit.id && l.date === today && l.completed)) {
    done++;
    total++;
  }
  return { done, total };
}

/**
 * One ConsistencyGrid row per habit — reused directly (not a new
 * component) since habit completion is a genuine binary/ternary categorical
 * state per day, unlike Reflection's ordinal severity scale.
 *
 * Three states, not two: days before a habit's committed_date are
 * "not_tracked" (no styled entry — renders via ConsistencyGrid's own muted
 * fallback); today, if not yet completed, is "in_progress" — a neutral
 * state distinct from "missed", since the day isn't over and hasn't
 * actually been failed yet (the same upcoming/missed distinction the
 * prayer-windows work draws, applied here). A day only becomes "missed"
 * once it's no longer today and still has no completed log.
 */
export function buildHabitConsistencyRows(
  habits: HabitConsistencyInput[],
  logs: HabitLogInput[],
  days: string[],
  today: string
): { label: string; cells: { date: string; status: string }[] }[] {
  return habits.map((habit) => ({
    label: habit.name,
    cells: days.map((date) => {
      if (date < habit.committedDate) return { date, status: "not_tracked" };
      const done = logs.some((l) => l.habitId === habit.id && l.date === date && l.completed);
      if (done) return { date, status: "done" };
      if (date === today) return { date, status: "in_progress" };
      return { date, status: "missed" };
    }),
  }));
}
