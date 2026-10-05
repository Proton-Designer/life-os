"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ListChecks, Repeat, Timer, type LucideIcon } from "lucide-react";
import { LockInHint } from "@/components/home/lock-in-hint";
import { IndicatorPopover } from "@/components/home/indicator-popover";
import { markPrayer } from "@/app/(app)/deen/actions";
import { useScheduleRefresh } from "@/components/deen/use-optimistic-item";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { Button } from "@/components/ui/button";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { buildDayBar, formatAwake, toGoLabel, type DayBarBlock, type DayBarCalendarEvent, type DayBarKind, type DayBarPopover, type DayBarPrayer } from "@/lib/home/day-bar";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";
import { formatHoursMinutes, hoursOfDailyTarget } from "@/lib/evening-close/format-hours";
import { cn } from "@/lib/utils";

// Never colour-only: every indicator carries an icon (and a label when wide enough), same vocabulary as the ribbon.
const KIND_ICON: Record<DayBarKind, LucideIcon> = {
  class: DOMAIN_ICON.school,
  work: DOMAIN_ICON.co_op,
  fitness: DOMAIN_ICON.fitness,
  task: ListChecks,
  focus: Timer,
  habit: Repeat,
  calendar: CalendarDays,
};
const KIND_LABEL: Record<DayBarKind, string> = { class: "Class", work: "Work", fitness: "Workout", task: "Task", focus: "Focus", habit: "Habit", calendar: "Calendar" };

const LANE_PX = 28;
const TRACK_PX = 48;

const fmtClock = (d: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(d);

const timeRange = (p: DayBarPopover, timezone: string) =>
  p.allDay ? "All day" : p.endAt ? `${fmtClock(p.startAt, timezone)}–${fmtClock(p.endAt, timezone)}` : fmtClock(p.startAt, timezone);

function PopoverDetails({ p, timezone }: { p: DayBarPopover; timezone: string }) {
  return (
    <>
      <p className="text-xs text-muted-foreground" data-testid="indicator-time">
        {timeRange(p, timezone)}
      </p>
      {p.location ? <p className="text-xs text-muted-foreground">{p.location}</p> : null}
      {p.instructor ? <p className="text-xs text-muted-foreground">{p.instructor}</p> : null}
      {p.description ? <p className="whitespace-pre-line text-xs">{p.description}</p> : null}
      {p.link ? (
        <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-2">
          Open
        </a>
      ) : null}
    </>
  );
}

const PRAYER_STATE_LABEL: Record<DayBarPrayer["state"], string> = { logged: "Logged", pending: "Open now", upcoming: "Upcoming", missed: "Missed" };

/**
 * The Day bar (HOME-02, redesigned by DAYBAR-02): the day on ONE timeline from Start Day to bedtime.
 *  - prayer windows (Faith on) are soft bands behind everything, the current one stronger;
 *  - fixed events (classes, work, workouts, timed tasks, calendar items) sit as solid blocks in lanes ABOVE
 *    the track, stacking into extra lanes on a collision; events too narrow to label become dots;
 *  - Lock-In blocks sit ON the track inside the awake span (they are the efficiency); the awake span fills from
 *    wake to NOW with a thin NOW line and the focus share as a strip;
 *  - an hour scale runs along the bottom; every indicator opens a popover (a bottom sheet on a phone).
 * Labels collapse to icons below sm. Reduced motion: nothing here animates.
 */
export function DayBar({
  layout,
  wokeAtIso,
  endIso,
  nowIso,
  hoursTodayMinutes,
  targetMinutes,
  efficiencyPercent,
  timezone,
  localDate,
  calendarEvents = [],
}: {
  layout: DayRibbonLayout | null;
  wokeAtIso: string;
  endIso: string;
  /** Server-computed now (ISO) -- the first render uses it, so there is no hydration mismatch or bar-width jump. */
  nowIso: string;
  hoursTodayMinutes: number;
  targetMinutes: number;
  efficiencyPercent: number | null;
  timezone: string;
  localDate: string;
  /** External calendar events (generic; a Google Calendar reader can feed this later). */
  calendarEvents?: DayBarCalendarEvent[];
}) {
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Marking a prayer from its popover is optimistic and queued per prayer, like the old ribbon's.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [markError, setMarkError] = useState<string | null>(null);
  const scheduleRefresh = useScheduleRefresh();
  function mark(name: string) {
    setMarkError(null);
    setMarked((prev) => new Set(prev).add(name));
    enqueueByKey(`prayer:${localDate}:${name}`, () => markPrayer(localDate, name as "fajr" | "dhuhr" | "asr" | "maghrib" | "isha", "on_time"))
      .catch((e: unknown) => {
        setMarkError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
        setMarked((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      })
      .finally(scheduleRefresh);
  }

  const wake = new Date(wokeAtIso);
  const end = new Date(endIso);
  const bar = buildDayBar({ layout, wake, end, now, efficiencyPercent, calendarEvents, timezone });
  const awakeSeconds = Math.max(0, (now.getTime() - wake.getTime()) / 1000);
  const toGo = toGoLabel(hoursTodayMinutes, targetMinutes, formatHoursMinutes);
  const fixed = bar.blocks.filter((b) => !b.isFocus);
  const focus = bar.blocks.filter((b) => b.isFocus);
  const lanesPx = bar.laneCount * LANE_PX;

  const eventButton = (b: DayBarBlock, i: number, shape: "pill" | "dot") => {
    const Icon = KIND_ICON[b.kind];
    const width = Math.min(Math.max(b.endPct - b.startPct, 1.2), 100);
    const left = `${Math.min(b.startPct, 100 - width)}%`;
    const label = `${KIND_LABEL[b.kind]}: ${b.popover.title}, ${timeRange(b.popover, timezone)}`;
    const common = cn("absolute flex items-center gap-1 overflow-hidden text-background", b.upcoming ? "opacity-70" : "opacity-95", b.isFocus && "ring-2 ring-primary");
    if (shape === "dot") {
      return (
        <IndicatorPopover
          key={i}
          title={b.popover.title}
          subtitle={b.popover.kindLabel}
          trigger={
            <button
              type="button"
              aria-label={label}
              data-testid="day-bar-dot"
              className={cn(common, "size-3.5 -translate-x-1/2 justify-center rounded-full")}
              style={{ left: `${b.startPct}%`, ...(b.isFocus ? { top: "50%", marginTop: -7 } : { bottom: b.lane * LANE_PX + 7 }), backgroundColor: `var(${b.colorVar})` }}
            />
          }
        >
          <PopoverDetails p={b.popover} timezone={timezone} />
        </IndicatorPopover>
      );
    }
    return (
      <IndicatorPopover
        key={i}
        title={b.popover.title}
        subtitle={b.popover.kindLabel}
        trigger={
          <button
            type="button"
            aria-label={label}
            data-testid={b.isFocus ? "day-bar-focus-block" : "day-bar-block"}
            className={cn(common, "h-6 min-w-6 rounded-md px-1")}
            style={{ left, width: `${width}%`, ...(b.isFocus ? { top: "50%", marginTop: -12 } : { bottom: b.lane * LANE_PX + 2 }), backgroundColor: `var(${b.colorVar})` }}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden truncate text-[10px] leading-none font-medium sm:inline">{b.label}</span>
          </button>
        }
      >
        <PopoverDetails p={b.popover} timezone={timezone} />
      </IndicatorPopover>
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4" data-testid="day-bar">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="font-mono text-sm font-semibold tabular-nums" data-testid="day-bar-awake">
          Awake for {formatAwake(awakeSeconds)}
        </p>
        <p className="font-mono text-sm tabular-nums" data-testid="day-bar-focus">
          <span className="font-semibold">Focus {formatHoursMinutes(hoursTodayMinutes)}</span>
          <span className="text-muted-foreground"> · {hoursOfDailyTarget(hoursTodayMinutes, targetMinutes)} h</span>
          {toGo ? <span className="text-muted-foreground"> · {toGo}</span> : null}
        </p>
        <p className="font-mono text-sm tabular-nums text-muted-foreground" data-testid="day-bar-efficiency">
          {efficiencyPercent === null ? "—" : `${efficiencyPercent}%`} focused
        </p>
      </div>

      {bar.allDay.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid="day-bar-allday">
          {bar.allDay.map((p, i) => (
            <IndicatorPopover
              key={i}
              title={p.title}
              subtitle={`${p.kindLabel} · all day`}
              trigger={
                <button type="button" className="rounded-full border px-2.5 py-0.5 text-xs" aria-label={`All day: ${p.title}`}>
                  {p.title}
                </button>
              }
            >
              <PopoverDetails p={p} timezone={timezone} />
            </IndicatorPopover>
          ))}
        </div>
      ) : null}

      {/* the chart: lanes of fixed events above, the track below; prayer bands sit behind both */}
      <div className="relative" data-testid="day-bar-chart" role="group" aria-label={`Your day from ${fmtClock(wake, timezone)} to ${fmtClock(end, timezone)}`}>
        <div className="relative" style={{ height: lanesPx + TRACK_PX }}>
          {bar.prayers.map((p) => {
            const shown = marked.has(p.name) ? "logged" : p.state;
            return (
              <IndicatorPopover
                key={p.name}
                title={p.label}
                subtitle="Prayer window"
                trigger={
                  <button
                    type="button"
                    aria-label={`${p.label} window, ${fmtClock(p.windowStart, timezone)}–${fmtClock(p.windowEnd, timezone)} (${PRAYER_STATE_LABEL[shown].toLowerCase()})`}
                    data-testid={`day-bar-prayer-${p.name}`}
                    data-state={shown}
                    data-current={p.current ? "true" : "false"}
                    className={cn(
                      "absolute inset-y-0 z-0 overflow-hidden rounded-md border-x text-left",
                      p.current ? "border-accent-deen/50 bg-accent-deen/25" : "border-accent-deen/20 bg-accent-deen/10",
                      shown === "logged" && "border-t-2 border-t-accent-deen",
                      shown === "missed" && "border-dashed border-destructive/60"
                    )}
                    style={{ left: `${p.startPct}%`, width: `${Math.max(p.endPct - p.startPct, 0.8)}%` }}
                  >
                    <span className="absolute inset-x-1 bottom-0.5 hidden truncate text-[10px] leading-none font-medium text-accent-deen sm:block">{p.label}</span>
                  </button>
                }
              >
                <p className="text-xs text-muted-foreground" data-testid="indicator-time">
                  {fmtClock(p.windowStart, timezone)}–{fmtClock(p.windowEnd, timezone)}
                </p>
                <p className="text-xs">Status: {PRAYER_STATE_LABEL[shown]}</p>
                {shown !== "logged" ? (
                  <Button type="button" size="sm" onClick={() => mark(p.name)} data-testid={`mark-prayer-${p.name}`}>
                    Mark on time
                  </Button>
                ) : null}
                {markError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {markError}
                  </p>
                ) : null}
              </IndicatorPopover>
            );
          })}

          {/* fixed events: lanes above the track; clipped so nothing overhangs the bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden" style={{ height: lanesPx }} data-testid="day-bar-lanes">
            <div className="pointer-events-auto relative h-full">
              {fixed.map((b, i) => eventButton(b, i, b.tiny ? "dot" : "pill"))}
            </div>
          </div>

          {/* the track */}
          <div className="absolute inset-x-0 bottom-0 z-10 rounded-lg" style={{ height: TRACK_PX }} data-testid="day-bar-track">
            <div className="absolute inset-0 overflow-hidden rounded-lg bg-muted/30">
              <div className="absolute inset-y-0 left-0 bg-accent-info/15" style={{ width: `${bar.awakePct}%` }} data-testid="day-bar-awake-span" />
              <div className="absolute bottom-0 left-0 h-1.5 bg-primary/60" style={{ width: `${bar.focusSharePct}%` }} data-testid="day-bar-focus-share" />
              <div className="pointer-events-none absolute inset-0" data-testid="day-bar-blocks">
                <div className="pointer-events-auto relative h-full">{focus.map((b, i) => eventButton(b, i, b.tiny ? "dot" : "pill"))}</div>
              </div>
            </div>
            {bar.nowPosition === "within" ? (
              <div className="absolute inset-y-0 z-20 w-px bg-accent-info" style={{ left: `${bar.nowPct}%` }} data-testid="day-bar-now">
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] leading-none whitespace-nowrap text-accent-info tabular-nums">
                  {fmtClock(now, timezone)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* hour scale */}
        <div className="relative mt-1 h-5" aria-hidden data-testid="day-bar-scale">
          {bar.ticks.map((t, i) => (
            <div key={i} className="absolute top-0 -translate-x-1/2" style={{ left: `${t.pct}%` }}>
              <div className={cn("mx-auto w-px bg-border", t.label ? "h-2" : "h-1")} />
              {t.label ? <span className="mt-0.5 block font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground tabular-nums">{t.label}</span> : null}
            </div>
          ))}
        </div>
      </div>

      {bar.blocks.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="day-bar-legend">
          {bar.blocks.map((b, i) => {
            const Icon = KIND_ICON[b.kind];
            return (
              <li key={i} className={cn("flex items-center gap-1.5", b.upcoming ? "text-muted-foreground" : "text-foreground")}>
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{b.label}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmtClock(b.startAt, timezone)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Today&apos;s classes, work, workouts and focus sessions will show up here as your day happens.</p>
      )}

      <LockInHint localDate={localDate} hoursTodayMinutes={hoursTodayMinutes} />
    </div>
  );
}
