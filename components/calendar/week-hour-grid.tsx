import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
export type CalendarItemKind = "class" | "work" | "fitness" | "task";

export type CalendarItemDetail = {
  timeRange: string;
  location?: string;
  instructor?: string;
  domainLabel: string;
};

export type CalendarItem = {
  id: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  title: string;
  subtitle?: string;
  startMinutes: number; // 0-1439
  durationMinutes: number;
  colorVar: string;
  kind: CalendarItemKind;
  detail?: CalendarItemDetail;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Below this, a squeezed column stops being a legible calendar — the day scrolls horizontally past it instead. */
const MIN_COLUMN_PX = 96;
const GUTTER_PX = 48;
const HOUR_ROW_PX = 48;
/** A block shorter than this can't hold a legible label without overflowing its own box — the color + click target still carries the information. */
const MIN_LABEL_MINUTES = 20;

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}${suffix}`;
}

/**
 * Grid alignment fix (Ayman, 2026-08-24 screenshot: "elements are
 * overlapping across different days, the day columns aren't clear"). The
 * old layout used TWO separate `grid-cols-7` grids (one for day labels, one
 * for tracks) inside a `minWidth`-on-children track — a child wider than
 * its 1fr track painted over its neighbour instead of widening the column,
 * and the label grid could drift out of alignment with the track grid
 * whenever that happened. Fixed by using ONE grid — a single
 * `gridTemplateColumns` (gutter + 7 `minmax(MIN,1fr)` day columns) shared
 * by every row via CSS grid auto-flow, all inside ONE horizontal-scroll
 * container so labels scroll with their columns. The hour gutter is
 * `sticky left-0` so it stays put while the day columns scroll.
 */
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
  const bodyHeightPx = hourMarks.length * HOUR_ROW_PX;

  return (
    <div className="overflow-x-auto" data-testid="week-hour-grid">
      <div
        className="grid"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(${MIN_COLUMN_PX}px, 1fr))` }}
      >
        <div className="sticky left-0 z-20 bg-background" />
        {DAY_LABELS.map((label, dow) => (
          <div
            key={dow}
            data-testid={`week-hour-grid-day-label-${dow}`}
            className={cn(
              "border-b border-border pb-2 text-center text-xs",
              dow === todayDayOfWeek ? "font-semibold text-accent-info" : "text-muted-foreground"
            )}
          >
            {label}
          </div>
        ))}

        <div className="sticky left-0 z-20 relative bg-background" style={{ height: `${bodyHeightPx}px` }}>
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
                "relative border-l border-border last:border-r",
                dow === todayDayOfWeek && "bg-accent-info/[0.06]"
              )}
              style={{ height: `${bodyHeightPx}px` }}
            >
              {hourMarks.map((m) => (
                <div
                  key={m}
                  className="absolute left-0 right-0 border-t border-border/30"
                  style={{ top: `${positionPct(m, axis.startMin, axis.endMin)}%` }}
                />
              ))}
              {layout.map(({ session, columnIndex, columnCount }) => {
                const item = itemById.get(session.id)!;
                const startPct = positionPct(session.startMinutes, axis.startMin, axis.endMin);
                const endPct = positionPct(session.startMinutes + session.durationMinutes, axis.startMin, axis.endMin);
                const widthPct = 100 / columnCount;
                const showLabel = item.durationMinutes >= MIN_LABEL_MINUTES;
                const label = item.subtitle ? `${item.title} — ${item.subtitle}` : item.title;
                const trigger = (
                  <button
                    key={session.id}
                    type="button"
                    data-testid={`week-hour-grid-item-${session.id}`}
                    aria-label={item.detail ? `${label}, ${item.detail.timeRange}` : label}
                    className="absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[10px] leading-tight font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent-info"
                    style={{
                      top: `${startPct}%`,
                      height: `${Math.max(endPct - startPct, 2)}%`,
                      left: `calc(${widthPct * columnIndex}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      backgroundColor: `color-mix(in oklch, var(${item.colorVar}) 30%, var(--card))`,
                      borderColor: `color-mix(in oklch, var(${item.colorVar}) 55%, transparent)`,
                      color: `var(${item.colorVar})`,
                    }}
                  >
                    {showLabel && <span className="block truncate">{item.title}</span>}
                  </button>
                );

                if (!item.detail) return trigger;

                return (
                  <Popover key={session.id}>
                    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                    <PopoverContent>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.detail.domainLabel}
                        </span>
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.detail.timeRange}</span>
                        {item.detail.location && <span className="text-xs text-muted-foreground">{item.detail.location}</span>}
                        {item.detail.instructor && (
                          <span className="text-xs text-muted-foreground">{item.detail.instructor}</span>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
