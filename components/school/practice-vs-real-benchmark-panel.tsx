import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { PracticeVsRealBenchmark } from "@/lib/school/practice-vs-real-benchmark";

/**
 * P3-12 — practice-test vs real-grade benchmarking. Same cross-class
 * rollup shape as deadline-risk-panel.tsx/course-load-forecast-panel.tsx
 * (Phase 1 #14 / P2-10), same honest-empty-state posture: no data yet
 * renders a plain message, never an empty list that could be misread as
 * "nothing to compare" rather than "haven't earned a comparison yet."
 */
export function PracticeVsRealBenchmarkPanel({ benchmark, todayStr }: { benchmark: PracticeVsRealBenchmark; todayStr: string }) {
  if (!benchmark.hasData) {
    // UX-03: the parent Panel (app/(app)/school/page.tsx) already renders
    // "Practice vs. real grade" as its own title unconditionally -- an
    // inner heading here just repeated it verbatim.
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Complete a practice test before a graded exam to see how it compared.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {benchmark.rows.map((row) => {
        // No "success" color token exists in this design system (globals.css
        // only defines accent-warning/destructive/info-shaped accents) --
        // doing worse than practice predicted is the one signal worth a
        // color here, same restrained "color = a real risk, not decoration"
        // posture deadline-risk-panel.tsx already takes.
        const worse = row.deltaPct < 0;
        const same = row.deltaPct === 0;
        return (
          <div key={row.assessmentId} className="flex flex-col gap-1 rounded-lg border border-border/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {row.assessmentName} <span className="text-xs text-muted-foreground">· {row.className}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(row.date, todayStr)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {row.practiceIntervalLabel} practice: <span className="tabular-nums text-foreground">{Math.round(row.practicePct)}%</span>
              </span>
              <span className="text-muted-foreground">
                Real: <span className="tabular-nums text-foreground">{Math.round(row.realPct)}%</span>
              </span>
              <span className={cn("tabular-nums font-medium", same ? "text-muted-foreground" : worse ? "text-destructive" : "text-foreground")}>
                {same ? "Matched" : `${worse ? "" : "+"}${Math.round(row.deltaPct)} pt${Math.abs(Math.round(row.deltaPct)) === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
