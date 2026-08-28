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

/** One day's resolved shift list — the override/cancellation resolution shared by the full grid and the compact strip, so there's exactly one place that decides what a day's schedule actually says. */
function eventsForDay(events: WorkScheduleEvent[], dow: number, dateForDay: string) {
  return events
    .filter((e) => (e.isRecurring && e.dayOfWeek === dow) || (!e.isRecurring && e.eventDate === dateForDay))
    .map((e) => {
      const isCancelled = e.cancelledDates.includes(dateForDay);
      const override = e.overrides.find((o) => o.date === dateForDay);
      const eventTime = override?.eventTime ?? e.eventTime;
      const endTime = override ? override.endTime : e.endTime;
      return { id: e.id, isCancelled, isOverride: !!override, eventTime, endTime };
    });
}

/** "9:00 AM–5:00 PM" for a single resolved shift, or a status word — used by both the full grid and the schedule strip's "today" line. */
function shiftLabel(shift: ReturnType<typeof eventsForDay>[number]): string {
  if (shift.isCancelled) return "Cancelled";
  if (!shift.eventTime) return "—";
  return `${formatTime(shift.eventTime)}${shift.endTime ? `–${formatTime(shift.endTime)}` : ""}`;
}

/** Today's timings for the schedule strip — e.g. "9:00 AM–5:00 PM", joined if more than one shift, or a clear "No shift today". Never derives today from `new Date()` — todayStr comes from the caller's own local-timezone computation. */
export function todayScheduleLabel(events: WorkScheduleEvent[], weekDates: string[], todayStr: string): string {
  const dow = weekDates.indexOf(todayStr);
  if (dow === -1) return "No shift today";
  const shifts = eventsForDay(events, dow, todayStr).filter((s) => !s.isCancelled && s.eventTime);
  if (shifts.length === 0) return "No shift today";
  return shifts.map(shiftLabel).join(", ");
}

/**
 * Item 4 (2026-08-26 night batch 2): today highlighted exactly like
 * School's ClassScheduleWeek (`isToday` -> `border-accent-info/50`), and
 * the actual start-end TIMES rendered per day instead of the literal word
 * "Work" ("ofcourse its work" — Ayman). Read-only; add/edit/remove happens
 * through the Edit popup (WorkHoursEditorDialog).
 *
 * `compact` (2026-08-28 batch 5, item 2): the same per-day resolution
 * rendered as a row of small shrink-0 chips in a horizontally-scrolling
 * strip, for the thin Work-schedule header — not a second implementation
 * of the override/cancellation logic, just a different container for
 * `eventsForDay`'s output.
 */
export function WorkScheduleWeek({
  events,
  weekDates,
  todayStr,
  compact,
}: {
  events: WorkScheduleEvent[];
  weekDates: string[];
  /** The user's own local date — never derived from `new Date()` here (AGENTS.md: the server's local day-of-week is not necessarily the user's). */
  todayStr: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex gap-1.5 overflow-x-auto" data-testid="work-schedule-week-compact">
        {DAY_LABELS.map((label, dow) => {
          const dateForDay = weekDates[dow];
          const isToday = dateForDay === todayStr;
          const dayEvents = eventsForDay(events, dow, dateForDay);
          return (
            <div
              key={dow}
              data-testid={`work-schedule-day-${dow}`}
              className={cn(
                "flex shrink-0 flex-col items-center gap-0.5 rounded-md border px-1.5 py-1",
                isToday ? "border-accent-info/50" : "border-border/40"
              )}
            >
              <span className="text-[10px] font-medium">{label}</span>
              {dayEvents.length === 0 ? (
                <span className="text-[9px] text-muted-foreground">—</span>
              ) : (
                dayEvents.map((shift) => (
                  <span
                    key={shift.id}
                    className={cn(
                      "whitespace-nowrap text-[9px] font-medium",
                      shift.isCancelled ? "text-destructive" : shift.isOverride ? "text-accent-warning" : undefined
                    )}
                  >
                    {shiftLabel(shift)}
                  </span>
                ))
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="work-schedule-week">
      {DAY_LABELS.map((label, dow) => {
        const dateForDay = weekDates[dow];
        const isToday = dateForDay === todayStr;
        const dayEvents = eventsForDay(events, dow, dateForDay);

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
                {dayEvents.map((shift) => (
                  <li key={shift.id} className="flex flex-col text-[11px]">
                    {shift.isCancelled ? (
                      <span className="font-medium text-destructive">Cancelled</span>
                    ) : shift.eventTime ? (
                      <span className={cn("font-medium", shift.isOverride && "text-accent-warning")}>
                        {shiftLabel(shift)}
                        {shift.isOverride && <span className="ml-1 font-normal text-muted-foreground">(this week)</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
