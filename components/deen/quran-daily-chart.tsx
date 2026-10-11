"use client";

import { dayOfWeekFromDateString } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * QURAN-03: pages read on each of the last 14 days. Every bar is a button (tap a day to open it in History), the left edge
 * has a scale, the dashed line is the plan's daily pace, and today is marked, so it reads at a glance without a legend.
 * An empty fortnight shows a plain sentence instead of a flat line.
 */
export function QuranDailyChart({ days, goal, todayStr, onSelectDay }: { days: { date: string; pages: number }[]; goal: number | null; todayStr: string; onSelectDay: (date: string) => void }) {
  const total = days.reduce((n, d) => n + d.pages, 0);
  const readDays = days.filter((d) => d.pages > 0).length;
  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="quran-chart-empty">
        Nothing logged in the last 14 days. Your daily pages will show here.
      </p>
    );
  }
  const top = Math.max(goal ?? 0, ...days.map((d) => d.pages), 1);
  const niceTop = top <= 5 ? top : Math.ceil(top / 5) * 5;
  const pct = (n: number) => `${Math.min(100, (n / niceTop) * 100)}%`;
  return (
    <div className="flex flex-col gap-1.5" data-testid="quran-chart">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Pages per day · last 14 days</span>
        <span>
          {total} pages · {readDays} day{readDays === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex gap-1.5">
        <div className="flex h-28 flex-col justify-between text-right text-[10px] leading-none text-muted-foreground" aria-hidden>
          <span>{niceTop}</span>
          <span>{Math.round(niceTop / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative flex h-28 items-end gap-1 border-b border-l border-border/60">
            {goal ? (
              <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent-deen/60" style={{ bottom: pct(goal) }} data-testid="quran-chart-goal">
                <span className="absolute -top-4 right-0 text-[10px] text-muted-foreground">Daily pace {Math.round(goal)}</span>
              </div>
            ) : null}
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelectDay(d.date)}
                title={`${d.date}: ${d.pages} page${d.pages === 1 ? "" : "s"}`}
                aria-label={`${d.date}: ${d.pages} pages. Open this day`}
                data-testid="quran-chart-bar"
                data-date={d.date}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <span className={cn("w-full rounded-t-sm transition-colors", d.pages > 0 ? "bg-accent-deen group-hover:opacity-80" : "bg-muted-foreground/15")} style={{ height: d.pages > 0 ? pct(d.pages) : "2px" }} />
                {d.pages > 0 ? <span className="absolute -top-4 text-[10px] text-muted-foreground">{d.pages}</span> : null}
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {days.map((d) => (
              <span key={d.date} className={cn("min-w-0 flex-1 text-center text-[10px] leading-tight text-muted-foreground", d.date === todayStr && "font-semibold text-foreground")}>
                {DAY_LETTERS[dayOfWeekFromDateString(d.date)]}
                <br />
                {Number(d.date.slice(8))}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
