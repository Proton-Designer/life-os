import { cn } from "@/lib/utils";
import type { WeekPreview, WeekPreviewItem } from "@/lib/fitness/plan-types";
import { computeAxis, layoutDaySessions, minutesFromMidnight, positionPct, type TimedSession } from "./day-grid";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Below this, a squeezed column stops being a legible calendar — the day scrolls horizontally past it instead. */
const MIN_COLUMN_PX = 72;

type ScheduledSession = Extract<WeekPreviewItem, { kind: "session" }> & { startTime: string };

function isScheduled(item: Extract<WeekPreviewItem, { kind: "session" }>): item is ScheduledSession {
  return item.startTime !== null;
}

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const suffix = h < 12 ? "AM" : "PM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}${suffix}`;
}

/**
 * Detailed hourly Sun–Sat calendar — My Workouts row 5. Pure presentational
 * (WeekPreview in, nothing else), same reasoning as WeekPreviewCalendar:
 * testable against fixtures the expander may never itself produce (three
 * overlapping sessions on one day, a mixed micro+session day).
 *
 * Axis is shared across all seven days (a per-day axis would make the hour
 * scale meaningless as a shared reference) and computed from every scheduled
 * session in the week — fixed 05:00-23:00 by default, expanding only when a
 * real session falls outside it (Opus Lead ruling, 2026-08-22).
 *
 * Overlapping sessions on the same day render as side-by-side columns, never
 * stacked with an indicator (same ruling) — a squeezed column has a floor:
 * below MIN_COLUMN_PX the day scrolls horizontally rather than compressing
 * into something unreadable.
 */
export function HourlyWeekCalendar({ preview, className }: { preview: WeekPreview; className?: string }) {
  const allScheduled: TimedSession[] = [];
  for (let d = 0; d <= 6; d++) {
    const items = preview[d] ?? [];
    for (const [i, item] of items.entries()) {
      if (item.kind === "session" && isScheduled(item)) {
        allScheduled.push({
          id: `${d}-${i}`,
          name: item.name,
          startMinutes: minutesFromMidnight(item.startTime),
          durationMinutes: item.durationMinutes,
        });
      }
    }
  }
  const axis = computeAxis(allScheduled);
  const hourMarks: number[] = [];
  for (let m = Math.ceil(axis.startMin / 60) * 60; m <= axis.endMin; m += 60) hourMarks.push(m);

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="hourly-week-calendar">
      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div />
        <div className="grid grid-cols-7 gap-2">
          {DAY_LABELS.map((label, dow) => {
            const items = preview[dow] ?? [];
            const micro = items.filter((i): i is Extract<WeekPreviewItem, { kind: "micro" }> => i.kind === "micro");
            const unscheduled = items.filter(
              (i): i is Extract<WeekPreviewItem, { kind: "session" }> => i.kind === "session" && i.startTime === null
            );
            return (
              <div key={dow} data-testid={`hourly-day-header-${dow}`} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                {micro.map((item, i) => (
                  <span
                    key={`micro-${i}`}
                    className="truncate rounded-md bg-accent-fitness/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-fitness"
                  >
                    {item.name} — {item.goalLabel}
                  </span>
                ))}
                {unscheduled.map((item, i) => (
                  <span
                    key={`unscheduled-${i}`}
                    className="truncate rounded-md border border-dashed border-border/60 px-1.5 py-0.5 text-[11px]"
                  >
                    {item.name} · unscheduled
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[3rem_1fr] gap-2">
        <div className="relative" style={{ height: `${hourMarks.length * 2.5}rem` }}>
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

        <div className="grid grid-cols-7 gap-2 overflow-x-auto" style={{ height: `${hourMarks.length * 2.5}rem` }}>
          {DAY_LABELS.map((_, dow) => {
            const items = preview[dow] ?? [];
            const scheduled: TimedSession[] = items
              .map((item, i) => ({ item, i }))
              .filter(
                (
                  x
                ): x is { item: Extract<WeekPreviewItem, { kind: "session" }> & { startTime: string }; i: number } =>
                  x.item.kind === "session" && x.item.startTime !== null
              )
              .map(({ item, i }) => ({
                id: `${dow}-${i}`,
                name: item.name,
                startMinutes: minutesFromMidnight(item.startTime),
                durationMinutes: item.durationMinutes,
              }));
            const layout = layoutDaySessions(scheduled);

            return (
              <div
                key={dow}
                data-testid={`hourly-day-track-${dow}`}
                className="relative rounded-lg border border-border/40"
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
                  const startPct = positionPct(session.startMinutes, axis.startMin, axis.endMin);
                  const endPct = positionPct(session.startMinutes + session.durationMinutes, axis.startMin, axis.endMin);
                  const widthPct = 100 / columnCount;
                  return (
                    <div
                      key={session.id}
                      data-testid={`hourly-session-${session.id}`}
                      className="absolute overflow-hidden rounded-md bg-accent-fitness/20 px-1 py-0.5 text-[10px] font-medium text-accent-fitness"
                      style={{
                        top: `${startPct}%`,
                        height: `${Math.max(endPct - startPct, 2)}%`,
                        left: `${widthPct * columnIndex}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      {session.name}
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
