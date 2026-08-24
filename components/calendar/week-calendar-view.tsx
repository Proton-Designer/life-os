"use client";

import { WeeklyGoalsHeader, type WeeklyGoalEntry } from "@/components/shared/weekly-goals-header";
import { WeekHourGrid, type CalendarItem } from "@/components/calendar/week-hour-grid";
import { Panel } from "@/components/ui/panel";

export type WeekCalendarData = {
  items: CalendarItem[];
  undatedDeadlines: { id: string; title: string; domainLabel: string; dueDate: string }[];
  deen: WeeklyGoalEntry;
  business: WeeklyGoalEntry;
};

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

/**
 * The whole week view's presentation, taking already-fetched, fully-
 * serializable data — shared between the `/calendar` route (page.tsx does
 * the fetch server-side) and the topbar's popup dialog (fetches on first
 * open via the getWeekCalendar Server Action, see calendar-dialog-trigger.tsx).
 * One component, two homes, same pattern as WeeklyGoalsHeader itself.
 */
export function WeekCalendarView({
  data,
  todayDayOfWeek,
  onSaveDeen,
  onSaveBusiness,
}: {
  data: WeekCalendarData;
  todayDayOfWeek?: number;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
}) {
  return (
    <div className="flex flex-col gap-6">
      <WeeklyGoalsHeader deen={data.deen} business={data.business} onSaveDeen={onSaveDeen} onSaveBusiness={onSaveBusiness} />

      <Panel title="Week">
        <WeekHourGrid items={data.items} todayDayOfWeek={todayDayOfWeek} />
      </Panel>

      {data.undatedDeadlines.length > 0 && (
        <Panel title="Also due this week">
          <ul className="flex flex-col gap-1.5">
            {data.undatedDeadlines.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.domainLabel} · due {t.dueDate}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
