"use client";

import { useEffect, useState } from "react";
import { ListChecks, Repeat, Timer, type LucideIcon } from "lucide-react";
import { LockInHint } from "@/components/home/lock-in-hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { buildDayBar, formatAwake, toGoLabel } from "@/lib/home/day-bar";
import type { DayRibbonLayout, RibbonActivityKind } from "@/lib/home/day-ribbon";
import { formatHoursMinutes, hoursOfDailyTarget } from "@/lib/evening-close/format-hours";
import { cn } from "@/lib/utils";

// Never colour-only: every block carries an icon AND a label (same vocabulary as the day ribbon).
const KIND_ICON: Record<RibbonActivityKind, LucideIcon> = {
  class: DOMAIN_ICON.school,
  work: DOMAIN_ICON.co_op,
  fitness: DOMAIN_ICON.fitness,
  task: ListChecks,
  focus: Timer,
  habit: Repeat,
};
const KIND_LABEL: Record<RibbonActivityKind, string> = { class: "Class", work: "Work", fitness: "Fitness", task: "Task", focus: "Focus", habit: "Habit" };

const fmtClock = (d: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(d);

/**
 * The Day bar (HOME-02, option A): Awake for / Focus / Efficiency and the day's shape in ONE card. A single
 * timeline from Start Day to bedtime with a live NOW marker; the shaded span is "awake so far" (the label
 * ticks), counted focus blocks are highlighted, the efficiency share is the strong strip inside the span,
 * and what is left of the day stays visible after NOW. Labels sit above and the block list below the bar, so
 * it reads at 390 px with no horizontal scroll. All values come from props (server) + the clock.
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
}) {
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const wake = new Date(wokeAtIso);
  const end = new Date(endIso);
  const bar = buildDayBar({ layout, wake, end, now, efficiencyPercent });
  const awakeSeconds = Math.max(0, (now.getTime() - wake.getTime()) / 1000);
  const toGo = toGoLabel(hoursTodayMinutes, targetMinutes, formatHoursMinutes);

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

      <div className="relative h-11 rounded-full bg-muted/40" role="img" aria-label={`Your day from ${fmtClock(wake, timezone)} to ${fmtClock(end, timezone)}`}>
        {/* awake so far */}
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-accent-info/15" style={{ width: `${bar.awakePct}%` }} data-testid="day-bar-awake-span" />
        {/* efficiency: the focused share of the awake span */}
        <div className="absolute bottom-0 left-0 h-1.5 rounded-bl-full bg-primary/60" style={{ width: `${bar.focusSharePct}%` }} data-testid="day-bar-focus-share" />
        {bar.prayers.map((p) => (
          <span
            key={p.name}
            title={`${p.label} · ${p.state}`}
            aria-label={`${p.label} (${p.state})`}
            data-testid={`day-bar-prayer-${p.name}`}
            className={cn(
              "absolute top-1 size-2 -translate-x-1/2 rounded-full",
              p.state === "logged" ? "bg-accent-deen" : p.state === "missed" ? "border border-destructive" : "border border-dashed border-muted-foreground/60"
            )}
            style={{ left: `${p.midPct}%` }}
          />
        ))}
        <div className="absolute inset-0 overflow-hidden rounded-full" data-testid="day-bar-blocks">
          {bar.blocks.map((b, i) => {
            const Icon = KIND_ICON[b.kind];
            // clamped so a block at the end of the day can never overhang the bar: width fits, then left is pulled
            // back so left + width <= 100 (and the blocks layer below clips any px min-width remainder)
            const width = Math.min(Math.max(1.2, b.endPct - b.startPct), 100);
            const left = `${Math.min(b.startPct, 100 - width)}%`;
            const pill = (
              <div
                data-testid={b.isFocus ? "day-bar-focus-block" : "day-bar-block"}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1.5 flex h-6 min-w-[0.75rem] items-center gap-1 overflow-hidden rounded-full px-1",
                  b.isFocus ? "ring-2 ring-primary" : "",
                  b.upcoming ? "opacity-60" : "opacity-90"
                )}
                style={{ left, width: `${width}%`, backgroundColor: `var(${b.colorVar})` }}
              >
                <Icon className="size-3.5 shrink-0 text-background" aria-hidden />
              </div>
            );
            return b.detail ? (
              <Popover key={i}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${KIND_LABEL[b.kind]}: ${b.detail.title}, ${b.detail.timeRange}`}
                    className="absolute top-1.5 h-6 min-w-6 rounded-full"
                    style={{ left, width: `${width}%` }}
                  />
                </PopoverTrigger>
                <PopoverContent align="center" className="w-64">
                  <p className="text-sm font-medium">{b.detail.title}</p>
                  <p className="text-xs text-muted-foreground">{b.detail.timeRange}</p>
                  {b.detail.location && <p className="text-xs text-muted-foreground">{b.detail.location}</p>}
                  {b.detail.instructor && <p className="text-xs text-muted-foreground">{b.detail.instructor}</p>}
                </PopoverContent>
                {pill}
              </Popover>
            ) : (
              <div key={i} title={`${KIND_LABEL[b.kind]}: ${b.label}`}>
                {pill}
              </div>
            );
          })}
        </div>
        {bar.nowPosition === "within" ? (
          <div className="absolute inset-y-0 z-10 w-0.5 bg-accent-info" style={{ left: `${bar.nowPct}%` }} data-testid="day-bar-now">
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] leading-none whitespace-nowrap text-accent-info">now</span>
          </div>
        ) : null}
      </div>

      <div className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>{fmtClock(wake, timezone)}</span>
        <span>{fmtClock(end, timezone)}</span>
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
