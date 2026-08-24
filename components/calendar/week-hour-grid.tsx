import { cn } from "@/lib/utils";
import {
  computeAxis,
  layoutDaySessions,
  positionPct,
  type TimedSession,
} from "@/components/fitness/workouts/day-grid";

/**
 * Reuses the fitness My Workouts calendar's pure clock-axis math
 * (components/fitness/workouts/day-grid.ts — minutesFromMidnight/
 * positionPct/computeAxis/layoutDaySessions) rather than duplicating it;
 * that module has no fitness-specific logic in it, only fitness-specific
 * doc comments. The RENDERING here is purpose-built, not a reuse of
 * HourlyWeekCalendar itself — that component is tightly coupled to
 * WeekPreviewItem's micro/session shape, and /calendar needs an arbitrary
 * cross-domain item (class, work, workout, deadline) with its own color
 * per source. Adapting HourlyWeekCalendar's JSX to a generic item would
 * have cost more than this ~120-line purpose-built grid; told to Opus
 * Lead as the reuse-vs-fork call (overnight session 2026-08-23/24).
 */
export type CalendarItem = {
  id: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  title: string;
  subtitle?: string;
  startMinutes: number; // 0-1439
  durationMinutes: number;
  colorVar: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Below this, a squeezed column stops being a legible calendar — the day scrolls horizontally past it instead. */
const MIN_COLUMN_PX = 88;

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}${suffix}`;
}

export function WeekHourGrid({ items, todayDayOfWeek }: { items: CalendarItem[]; todayDayOfWeek?: number }) {
  const allTimed: TimedSession[] = items.map((i) => ({
    id: i.id,
    name: i.title,
    startMinutes: i.startMinutes,
    durationMinutes: i.durationMinutes,
  }));
  const axis = computeAxis(allTimed);
  const hourMarks: number[] = [];
  for (let m = Math.ceil(axis.startMin / 60) * 60; m <= axis.endMin; m += 60) hourMarks.push(m);

  return (
    <div className="flex flex-col gap-2" data-testid="week-hour-grid">
      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div />
        <div className="grid grid-cols-7 gap-2">
          {DAY_LABELS.map((label, dow) => (
            <span
              key={dow}
              data-testid={`week-hour-grid-day-label-${dow}`}
              className={cn("text-xs", dow === todayDayOfWeek ? "font-semibold text-accent-info" : "text-muted-foreground")}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div className="relative" style={{ height: `${hourMarks.length * 3}rem` }}>
          {hourMarks.map((m) => (
            <span
              key={m}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
              style={{ top: `${positionPct(m, axis.startMin, axis.endMin)}%` }}
            >
              {hourLabel(m)}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2 overflow-x-auto" style={{ height: `${hourMarks.length * 3}rem` }}>
          {DAY_LABELS.map((_, dow) => {
            const dayItems = items.filter((i) => i.dayOfWeek === dow);
            const layout = layoutDaySessions(
              dayItems.map((i) => ({ id: i.id, name: i.title, startMinutes: i.startMinutes, durationMinutes: i.durationMinutes }))
            );
            const itemById = new Map(dayItems.map((i) => [i.id, i]));

            return (
              <div
                key={dow}
                data-testid={`week-hour-grid-track-${dow}`}
                className={cn(
                  "relative rounded-lg border",
                  dow === todayDayOfWeek ? "border-accent-info/50" : "border-border/40"
                )}
                style={{ minWidth: MIN_COLUMN_PX }}
              >
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-t border-border/20"
                    style={{ top: `${positionPct(m, axis.startMin, axis.endMin)}%` }}
                  />
                ))}
                {layout.map(({ session, columnIndex, columnCount }) => {
                  const item = itemById.get(session.id)!;
                  const startPct = positionPct(session.startMinutes, axis.startMin, axis.endMin);
                  const endPct = positionPct(session.startMinutes + session.durationMinutes, axis.startMin, axis.endMin);
                  const widthPct = 100 / columnCount;
                  return (
                    <div
                      key={session.id}
                      data-testid={`week-hour-grid-item-${session.id}`}
                      title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
                      className="absolute overflow-hidden rounded-md px-1 py-0.5 text-[10px] font-medium opacity-90"
                      style={{
                        top: `${startPct}%`,
                        height: `${Math.max(endPct - startPct, 2)}%`,
                        left: `${widthPct * columnIndex}%`,
                        width: `${widthPct}%`,
                        backgroundColor: `color-mix(in oklch, var(${item.colorVar}) 22%, transparent)`,
                        color: `var(${item.colorVar})`,
                      }}
                    >
                      {item.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
