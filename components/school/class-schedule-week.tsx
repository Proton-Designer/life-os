import { cn } from "@/lib/utils";

export type ClassScheduleEvent = {
  id: string;
  title: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  eventTime: string | null;
  endTime: string | null;
  location: string | null;
  instructor: string | null;
  cancelledOn: string | null;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The week's recurring classes grouped by day, each showing its time
 * range, room, and instructor — overnight session 2026-08-23/24, item 1:
 * "all my classes ... with all the necessary information." Read-only;
 * adding/cancelling a recurring event still happens through the existing
 * "Class schedule" panel below (DomainScheduleView) — this panel is
 * purely about seeing the week's real detail at a glance, which that
 * generic component (shared with Work/Co-op) doesn't carry.
 */
export function ClassScheduleWeek({
  events,
  weekDates,
  todayStr,
}: {
  events: ClassScheduleEvent[];
  weekDates: string[];
  /** The user's own local date (e.g. localDateString(now, profile.timezone)) — never derived from `new Date()` here, which would run on the SERVER's local day-of-week, not the user's (AGENTS.md: this class of bug has shipped twice). */
  todayStr: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7" data-testid="class-schedule-week">
      {DAY_LABELS.map((label, dow) => {
        const dateForDay = weekDates[dow];
        const isToday = dateForDay === todayStr;
        const dayEvents = events
          .filter((e) => e.dayOfWeek === dow && e.cancelledOn !== dateForDay)
          .filter((e) => e.eventTime !== null)
          .sort((a, b) => a.eventTime!.localeCompare(b.eventTime!));

        return (
          <div
            key={dow}
            data-testid={`class-schedule-day-${dow}`}
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
                {dayEvents.map((e) => (
                  <li key={e.id} className="flex flex-col text-[11px]">
                    <span className="font-medium">{e.title}</span>
                    <span className="text-muted-foreground">
                      {formatTime(e.eventTime!)}
                      {e.endTime ? `–${formatTime(e.endTime)}` : ""}
                    </span>
                    {e.location && <span className="text-muted-foreground">{e.location}</span>}
                    {e.instructor && <span className="text-muted-foreground">{e.instructor}</span>}
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
