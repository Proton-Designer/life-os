import { TASK_GROUP_ORDER, TASK_GROUP_LABEL, groupTasksByBucket } from "@/lib/tasks/task-groups";
import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";

export type DeadlineRiskRow = {
  id: string;
  name: string;
  className: string;
  dueDate: string | null;
  risk: { score: number; band: RiskBand };
};

// Same band->color convention class-assessments.tsx uses for type (TYPE_COLOR) — this is
// the risk engine's own band vocabulary (assignment-risk.ts's bandForScore), not a new one.
const BAND_COLOR: Record<RiskBand, string> = {
  low: "text-muted-foreground",
  moderate: "text-accent-warning",
  high: "text-destructive",
  critical: "text-destructive font-semibold",
};
const BAND_LABEL: Record<RiskBand, string> = { low: "Low", moderate: "Moderate", high: "High", critical: "Critical" };

/**
 * Phase 1 #14 — the cross-class deadline/risk dashboard. Item-level risk
 * (`computeAssignmentRisk`) already had a UI caller per-class
 * (class-assessments.tsx); this is the cross-class rollup the plan asked
 * for — every upcoming assessment across every class, one list, ranked by
 * risk within the SAME due-date buckets the Task list already uses.
 *
 * Deliberately reuses `groupTasksByBucket`/`TASK_GROUP_ORDER`/`TASK_GROUP_LABEL`
 * (lib/tasks/task-groups.ts) rather than re-deriving the due-date vocabulary —
 * Opus Lead ruling. Overdue is excluded from render the same way
 * `TaskListModule` excludes it (`TASK_GROUP_ORDER` itself omits it) — an
 * ungraded past-due assessment is a real thing, but this panel intentionally
 * matches the app's one established bucketing convention rather than
 * inventing a second exception to it.
 *
 * Only the risk ORDER within each bucket is this panel's own decision — the
 * BUCKET ASSIGNMENT itself comes from `groupTasksByBucket`, unmodified.
 */
export function DeadlineRiskPanel({
  rows,
  todayStr,
  weekDates,
  nextWeekDates,
  horizonStr,
}: {
  rows: DeadlineRiskRow[];
  todayStr: string;
  weekDates: string[];
  nextWeekDates: string[];
  horizonStr: string;
}) {
  const groups = groupTasksByBucket(rows, todayStr, weekDates, nextWeekDates, horizonStr);
  // groupTasksByBucket sorts each bucket soonest-first (its own contract); this panel is
  // about risk, not chronology, so it re-ranks highest-risk-first within the buckets it
  // renders — the date order it discards is still what TaskListModule shows elsewhere.
  const byBucket = TASK_GROUP_ORDER.map((key) => ({
    key,
    items: [...groups[key]].sort((a, b) => b.risk.score - a.risk.score),
  })).filter((g) => g.items.length > 0);

  if (byBucket.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Deadline risk</h3>
        <p className="text-xs text-muted-foreground">No upcoming assessments across your classes.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {byBucket.map(({ key, items }) => (
        <div key={key} className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">{TASK_GROUP_LABEL[key]}</p>
          <div className="flex flex-col gap-1">
            {items.map((row) => (
              <div
                key={row.id}
                data-testid={`deadline-risk-row-${row.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.className}
                    {row.dueDate && ` · ${formatShortDate(row.dueDate, todayStr)}`}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs", BAND_COLOR[row.risk.band])}>{BAND_LABEL[row.risk.band]}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
