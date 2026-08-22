import { cn } from "@/lib/utils";
import type { WeekPreview, WeekPreviewItem } from "@/lib/fitness/plan-types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Generic Sun–Sat preview grid — no hours, no real dates. Used both inside
 * the builder (updating live from unsaved draft state) and, per My
 * Workouts row 4, previewing a plan the user just tapped in the list
 * without activating it. Pure presentational: takes a WeekPreview and
 * nothing else, so it's testable against hand-written fixtures rather than
 * only through expandPlanToWeek — see day-grid.test.ts's sibling reasoning.
 *
 * Micro bands always render before session bands within a day (plan gap
 * resolution #5) regardless of the input array's order, since a merged
 * preview (active micro plan + active routine plan) can legitimately
 * interleave the two archetypes.
 */
export function WeekPreviewCalendar({ preview, className }: { preview: WeekPreview; className?: string }) {
  return (
    <div className={cn("grid grid-cols-7 gap-2", className)} data-testid="week-preview-calendar">
      {DAY_LABELS.map((label, dow) => {
        const items = preview[dow] ?? [];
        const micro = items.filter((i): i is Extract<WeekPreviewItem, { kind: "micro" }> => i.kind === "micro");
        const sessions = items.filter((i): i is Extract<WeekPreviewItem, { kind: "session" }> => i.kind === "session");
        return (
          <div
            key={dow}
            data-testid={`week-preview-day-${dow}`}
            className="flex min-h-16 flex-col gap-1 rounded-lg border border-border/40 p-2"
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            {micro.map((item, i) => (
              <span
                key={`micro-${i}`}
                className="truncate rounded-md bg-accent-fitness/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-fitness"
              >
                {item.name} — {item.goalLabel}
              </span>
            ))}
            {sessions.map((item, i) => (
              <span
                key={`session-${i}`}
                className="truncate rounded-md border border-border/40 px-1.5 py-0.5 text-[11px] font-medium"
              >
                {item.name}
                {item.startTime ? ` · ${item.startTime}` : " · unscheduled"}
              </span>
            ))}
            {micro.length === 0 && sessions.length === 0 && (
              <span className="text-[11px] text-muted-foreground/60">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
