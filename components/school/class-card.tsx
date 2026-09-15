"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClassDetailDialog } from "@/components/school/class-detail-dialog";
import { formatShortDate } from "@/lib/date-utils";
import { computeCourseRisk } from "@/lib/school/risk/course-risk";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";
import { cn } from "@/lib/utils";
import type { ClassCardData } from "@/lib/school/get-class-cards";

// Same band vocabulary as deadline-risk-panel.tsx's BAND_COLOR/BAND_LABEL — kept as its
// own copy rather than a shared import: this card is a compact badge (label only, no
// full sentence), the panel is a full row, and neither would gain from forcing one
// shape on the other. The COLORS agree because both key off RiskBand, not by convention.
const COURSE_RISK_COLOR: Record<RiskBand, string> = {
  low: "text-muted-foreground",
  moderate: "text-accent-warning",
  high: "text-destructive",
  critical: "text-destructive font-semibold",
};
const COURSE_RISK_LABEL: Record<RiskBand, string> = { low: "Low risk", moderate: "Moderate risk", high: "High risk", critical: "Critical risk" };

/**
 * One class's card in the School screen's classes grid (item 6b, Ayman's
 * spec, verbatim): abbreviated name; below it in smaller text the real
 * code, room and teacher; a task-due-this-week count; an upcoming test
 * name+date; a "View" button top-right opening the expanded class view.
 *
 * Purely presentational — takes already-shaped data, fetches nothing
 * itself (lib/school/get-class-cards.ts does the shaping), same pattern
 * as WeekCalendarView/HabitBuilder elsewhere in this app. `short_name`
 * falls back to `code` when null (Opus Lead ruling: seeding it is a
 * hand-run data step, not guaranteed to have happened yet, so a class
 * without one must still render correctly, not as a blank).
 */
export function ClassCard({
  data,
  timezone,
  todayStr,
  hasOpenAiKey = false,
  hasGoogleKey = false,
}: {
  data: ClassCardData;
  timezone: string;
  /** Today in the user's timezone, computed on the SERVER and passed down.
   * Only used as `formatShortDate`'s reference year, but deriving it here
   * from `new Date()` would compute it once at SSR and again at hydration
   * — identical on all but one day of the year, which is exactly the kind
   * of "works until it doesn't" this app has been bitten by. */
  todayStr: string;
  /** P3-15 — account-wide (not per-class), threaded through to LecturePanel. */
  hasOpenAiKey?: boolean;
  hasGoogleKey?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const displayName = data.shortName ?? data.code;
  // Phase 1 #14 — course-risk.ts's first production caller (previously zero callers
  // anywhere in the app, per that file's own header). Softmax-weighted across this
  // class's own assessment-level risk scores (already computed by get-class-cards.ts),
  // never re-scored here. Hidden with zero assessments — computeCourseRisk's own
  // "insufficient" confidence for that shape, and a risk badge on a class with nothing
  // to be at risk of is a fabricated number, not a real one.
  const courseRisk = computeCourseRisk({ items: data.assessments.map((a) => ({ id: a.id, score: a.risk.score })) });

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{displayName}</h3>
              {courseRisk.confidence !== "insufficient" && (
                <span className={cn("shrink-0 text-xs", COURSE_RISK_COLOR[courseRisk.band])}>
                  {COURSE_RISK_LABEL[courseRisk.band]}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {data.code}
              {data.room && ` · ${data.room}`}
              {data.instructor && ` · ${data.instructor}`}
            </p>
          </div>
          {/* Visible text stays "View" — only the accessible name is
              per-class ("View DSA", "View Prob & Stats", ...). Six cards
              with identical accessible names is a real screen-reader
              defect (a fourth instance of this class tonight), not just a
              locator inconvenience — falls back to `code` via the same
              `displayName` the card's own title uses, so a class added
              later with no short_name yet doesn't quietly recreate it. */}
          <Button type="button" variant="outline" size="sm" aria-label={`View ${displayName}`} onClick={() => setOpen(true)}>
            View
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-mono text-lg font-semibold tabular-nums">{data.tasksDueThisWeek}</span>
            <span className="text-xs text-muted-foreground">
              task{data.tasksDueThisWeek === 1 ? "" : "s"} due this week
            </span>
          </div>
          {data.upcomingAssessment ? (
            // min-w-0 is load-bearing: this div's automatic minimum size
            // (min-width:auto) otherwise refuses to shrink below the
            // assessment name's min-content, so a long name pushes the row
            // past the card instead of truncating — measured 2026-08-28 at
            // 390px, a 595px row inside a 386px card.
            <div className="flex min-w-0 flex-col items-end text-right">
              <span className="truncate text-sm font-medium">{data.upcomingAssessment.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatShortDate(data.upcomingAssessment.date, todayStr)}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No upcoming test</span>
          )}
        </div>
      </div>

      <ClassDetailDialog
        open={open}
        onOpenChange={setOpen}
        classData={data}
        timezone={timezone}
        hasOpenAiKey={hasOpenAiKey}
        hasGoogleKey={hasGoogleKey}
      />
    </>
  );
}
