import { localDateString, getWeekStartDate } from "@/lib/date-utils";

export type CompletedTaskInput = { id: string; title: string; meta: string; completedAt: string };
export type CompletedWeekGroup = {
  weekStart: string;
  weekLabel: string;
  items: { id: string; title: string; meta: string }[];
};

/** "Week of Aug 18" — a plain calendar-date label; safe to format with a fixed UTC offset since weekStart is already a resolved local calendar date, not a "now"-relative instant (see formatBacklogDate in qada-backlog-card.tsx for the same established pattern). */
function formatWeekLabel(weekStartDateStr: string): string {
  const label = new Date(`${weekStartDateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Week of ${label}`;
}

/**
 * Groups completed tasks by the LOCAL week their completion instant fell
 * in — never a raw UTC week (AGENTS.md: a calendar date/week is a function
 * of an instant AND a timezone). Most recent week first; each week's own
 * items in completion order (Ayman: "in order of when they were
 * completed"). Weeks start Sunday, repo-wide (getWeekStartDate).
 */
export function groupCompletedTasksByWeek(tasks: CompletedTaskInput[], timezone: string): CompletedWeekGroup[] {
  const weekGroups = new Map<string, CompletedTaskInput[]>();
  for (const t of tasks) {
    const completedLocalDate = localDateString(new Date(t.completedAt), timezone);
    const weekStart = getWeekStartDate(completedLocalDate);
    const list = weekGroups.get(weekStart) ?? [];
    list.push(t);
    weekGroups.set(weekStart, list);
  }

  return Array.from(weekGroups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekStart, items]) => ({
      weekStart,
      weekLabel: formatWeekLabel(weekStart),
      items: [...items]
        .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
        .map(({ id, title, meta }) => ({ id, title, meta })),
    }));
}
