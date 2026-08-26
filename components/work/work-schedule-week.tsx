import { cn } from "@/lib/utils";

export type WorkScheduleEvent = {
  id: string;
  isRecurring: boolean;
  dayOfWeek: number | null;
  eventDate: string | null;
  eventTime: string | null;
  endTime: string | null;
  cancelledDates: string[];
  /** Temporary (this-week/next-week) time replacements, keyed by the specific occurrence date — see schedule_event_overrides (migration 050). */
  overrides: { date: string; eventTime: string; endTime: string | null }[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Item 4 (2026-08-26 night batch 2): today highlighted exactly like
 * School's ClassScheduleWeek (`isToday` -> `border-accent-info/50`), and
 * the actual start-end TIMES rendered per day instead of the literal word
 * "Work" ("ofcourse its work" — Ayman). Read-only; add/edit/remove happens
 * through the Edit popup (WorkHoursEditorDialog).
 */
export function WorkScheduleWeek({
  events,
  weekDates,
  todayStr,
}: {
  events: WorkScheduleEvent[];
  weekDates: string[];
  /** The user's own local date — never derived from `new Date()` here (AGENTS.md: the server's local day-of-week is not necessarily the user's). */
  todayStr: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="work-schedule-week">
      {DAY_LABELS.map((label, dow) => {
        const dateForDay = weekDates[dow];
        const isToday = dateForDay === todayStr;
        const dayEvents = events.filter(
          (e) => (e.isRecurring && e.dayOfWeek === dow) || (!e.isRecurring && e.eventDate === dateForDay)
        );

        return (
          <div
            key={dow}
            data-testid={`work-schedule-day-${dow}`}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-2",
              isToday ? "border-accent-info/50" : "border-border/40"
            )}
          >
            <span className="text-xs font-medium">{label}</span>
            {dayEvents.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">—</span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {dayEvents.map((e) => {
                  const isCancelled = e.cancelledDates.includes(dateForDay);
                  const override = e.overrides.find((o) => o.date === dateForDay);
                  const eventTime = override?.eventTime ?? e.eventTime;
                  const endTime = override ? override.endTime : e.endTime;
                  return (
                    <li key={e.id} className="flex flex-col text-[11px]">
                      {isCancelled ? (
                        <span className="font-medium text-destructive">Cancelled</span>
                      ) : eventTime ? (
                        <span className={cn("font-medium", override && "text-accent-warning")}>
                          {formatTime(eventTime)}
                          {endTime ? `–${formatTime(endTime)}` : ""}
                          {override && <span className="ml-1 font-normal text-muted-foreground">(this week)</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
