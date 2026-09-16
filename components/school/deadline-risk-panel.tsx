import { ChevronDown } from "lucide-react";
import { TASK_GROUP_ORDER, TASK_GROUP_LABEL, groupTasksByBucket } from "@/lib/tasks/task-groups";
import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
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

// UX-06 -- at real volume (a class with 40+ assessments) this panel was
// dumping every low-severity item in one flat list with no hierarchy, the
// same "feature dump" problem the user complained about, just triggered by
// data volume instead of by default. High/critical risk always stays fully
// visible (that's the whole point of a risk panel); low/moderate rows past
// this count collapse behind an explicit, always-reachable "+N more" --
// never a silent drop, per the AC's own "nothing hidden silently" bar.
const HIGH_SEVERITY_BANDS: ReadonlySet<RiskBand> = new Set(["high", "critical"]);
const VISIBLE_LOW_SEVERITY_CAP = 5;

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
    // UX-03: the parent Panel (app/(app)/school/page.tsx) already renders
    // "Deadline risk" as its own title unconditionally -- an inner heading
    // here just repeated it verbatim.
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">No upcoming assessments across your classes.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {byBucket.map(({ key, items }) => {
        // Bucket order is already risk-descending (line 61 above), and band
        // is monotonic with score (assignment-risk.ts's own bandForScore),
        // so filtering by band here preserves that order in both slices.
        const highSeverity = items.filter((row) => HIGH_SEVERITY_BANDS.has(row.risk.band));
        const lowSeverity = items.filter((row) => !HIGH_SEVERITY_BANDS.has(row.risk.band));
        const visibleLow = lowSeverity.slice(0, VISIBLE_LOW_SEVERITY_CAP);
        const hiddenLow = lowSeverity.slice(VISIBLE_LOW_SEVERITY_CAP);
        return (
          <div key={key} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{TASK_GROUP_LABEL[key]}</p>
            <div className="flex flex-col gap-1">
              {[...highSeverity, ...visibleLow].map((row) => (
                <DeadlineRiskRow key={row.id} row={row} todayStr={todayStr} />
              ))}
            </div>
            {hiddenLow.length > 0 && (
              <Collapsible className="flex flex-col gap-1">
                <CollapsibleTrigger className="group flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown className="size-3 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
                  +{hiddenLow.length} more
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-1">
                  {hiddenLow.map((row) => (
                    <DeadlineRiskRow key={row.id} row={row} todayStr={todayStr} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeadlineRiskRow({ row, todayStr }: { row: DeadlineRiskRow; todayStr: string }) {
  return (
    <div
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
  );
}
