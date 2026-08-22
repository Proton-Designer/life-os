import type { WeekDayStatus } from "@/lib/fitness/week-status";
import { cn } from "@/lib/utils";

export type ThisWeekMicroItem = { name: string; goalLabel: string };
export type ThisWeekSession = { name: string; startTime: string | null; durationMinutes: number; confirmed: boolean };
export type ThisWeekDay = {
  dateStr: string;
  dayLabel: string;
  isToday: boolean;
  microItems: ThisWeekMicroItem[];
  sessions: ThisWeekSession[];
  /** null when the day has no scheduled routine sessions — status is about session completion, not the continuous micro goals. */
  status: WeekDayStatus | null;
};

const STATUS_LABEL: Record<WeekDayStatus, string> = {
  completed: "Completed",
  active: "Today",
  upcoming: "Upcoming",
  missed: "Missed",
};
const STATUS_CLASS: Record<WeekDayStatus, string> = {
  completed: "bg-accent-fitness/15 text-accent-fitness",
  active: "bg-accent-info/15 text-accent-info",
  upcoming: "bg-muted text-muted-foreground",
  missed: "bg-destructive/15 text-destructive",
};

/**
 * "This week" merged with the old "Sessions" panel (spec): one real
 * Sun-Sat calendar with real dates, live status. Server-renderable — no
 * interactivity here, confirming a session happens in the Daily Log module
 * (spec's "every action fully resolved by tapping the log item," not a
 * second confirm surface living on the calendar too).
 */
export function ThisWeekCalendar({ days }: { days: ThisWeekDay[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="this-week-calendar">
      {days.map((day) => (
        <div
          key={day.dateStr}
          className={cn("flex flex-col gap-1.5 rounded-lg border p-2", day.isToday ? "border-accent-info/50" : "border-border/40")}
          data-testid={`this-week-day-${day.dateStr}`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{day.dayLabel}</span>
            {day.status && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", STATUS_CLASS[day.status])}>
                {STATUS_LABEL[day.status]}
              </span>
            )}
          </div>
          {day.microItems.length === 0 && day.sessions.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">—</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {day.microItems.map((item) => (
                <li key={item.name} className="text-[11px] text-muted-foreground">
                  {item.name} · {item.goalLabel}
                </li>
              ))}
              {day.sessions.map((session) => (
                <li
                  key={session.name}
                  className={cn("text-[11px]", session.confirmed ? "text-accent-fitness" : "text-foreground")}
                >
                  {session.name}
                  {session.startTime ? ` · ${session.startTime}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
