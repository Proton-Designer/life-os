import { addDaysToDateString, formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { CourseLoadForecast } from "@/lib/school/course-load-forecast";

/**
 * Phase 2 #P2-10 — course-load forecasting with overflow warnings.
 * Same "cross-class rollup" shape as deadline-risk-panel.tsx (Phase 1
 * #14), same honest-empty-state posture: `!forecast.hasAnyUpcomingWork`
 * renders a plain message, never an all-zero grid dressed up as a real
 * forecast.
 */
export function CourseLoadForecastPanel({ forecast, todayStr }: { forecast: CourseLoadForecast; todayStr: string }) {
  if (!forecast.hasAnyUpcomingWork) {
    // UX-03: the parent Panel (app/(app)/school/page.tsx) already renders
    // "Course load" as its own title unconditionally -- an inner heading
    // here just repeated it verbatim.
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Not enough upcoming, ungraded assessments to forecast your course load yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {forecast.weeks.map((week) => {
        const weekEndInclusive = addDaysToDateString(week.weekStart, 6);
        return (
          <div
            key={week.weekStart}
            data-testid={`course-load-week-${week.weekStart}`}
            className="flex flex-col gap-1.5 rounded-lg border border-border/40 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {formatShortDate(week.weekStart, todayStr)} – {formatShortDate(weekEndInclusive, todayStr)}
              </p>
              {week.overflow && (
                <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">Overflow</span>
              )}
            </div>
            {week.itemCount === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing due.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {week.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {item.name} <span className="text-xs text-muted-foreground">· {item.className}</span>
                    </span>
                    {item.weightPct !== null && (
                      <span className={cn("shrink-0 text-xs tabular-nums", item.heavy ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {item.weightPct}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
