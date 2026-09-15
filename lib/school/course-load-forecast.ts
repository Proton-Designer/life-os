import { getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";

/**
 * Phase 2 #P2-10 — course-load forecasting with overflow warnings.
 *
 * PURE, no I/O: the caller (app/(app)/school/page.tsx) already fetches
 * every class's assessments via `getClassCards` for the Deadline Risk
 * panel (Phase 1 #14) — this reuses that SAME data, not a second query.
 *
 * WHY OVERFLOW ISN'T A SUMMED weight_pct THRESHOLD: `weight_pct` is
 * per-CLASS ("this exam is 30% of THIS class's grade") — summing it
 * across different classes due the same week (30% of class A + 20% of
 * class B) does not yield a meaningful "50% of something." Overflow is
 * instead driven by two commensurable signals: how many items land in a
 * week (regardless of class), and how many of those are individually
 * "heavy" (a high stake within their OWN class). `totalWeightPct` is still
 * reported per week as a rough combined-magnitude figure — useful context,
 * never the overflow trigger itself.
 *
 * HONEST EMPTY STATE: this module never fabricates a forecast from zero
 * data. `computeCourseLoadForecast` always returns a full N-week grid
 * (including weeks with nothing due — that IS the forecast, a light week
 * is real information), but `hasAnyUpcomingWork` tells the caller when
 * every week is empty, so the UI can show "not enough data" instead of an
 * all-zero grid that could be misread as "definitely nothing coming."
 */

const FORECAST_HORIZON_WEEKS = 6;
/** 3+ items due in the same week is overflow regardless of their individual weight. */
const OVERFLOW_ITEM_COUNT_THRESHOLD = 3;
/** An item worth >=20% of its OWN class's grade counts as "heavy" — same order of magnitude as assignment-risk.ts's WEIGHT_SATURATION_PCT (25), deliberately a touch lower since this is a coarser per-item flag, not that engine's own saturation curve. */
const HEAVY_WEIGHT_PCT_THRESHOLD = 20;
/** 2+ heavy items in the same week is overflow even when the raw count is otherwise low (e.g. two 30%-of-grade exams and nothing else that week). */
const OVERFLOW_HEAVY_ITEM_THRESHOLD = 2;

export interface ForecastableAssessment {
  id: string;
  name: string;
  className: string;
  /** "YYYY-MM-DD" */
  date: string;
  weightPct: number | null;
  pointsEarned: number | null;
  isExcused: boolean;
}

export interface ForecastItem {
  id: string;
  name: string;
  className: string;
  date: string;
  weightPct: number | null;
  /** True when this single item is individually heavy — see HEAVY_WEIGHT_PCT_THRESHOLD. */
  heavy: boolean;
}

export interface ForecastWeek {
  /** Sunday, "YYYY-MM-DD". */
  weekStart: string;
  items: ForecastItem[];
  itemCount: number;
  heavyItemCount: number;
  /** Sum of every item's weightPct in this week (nulls excluded from the sum, never treated as 0) — a rough combined-magnitude figure, not a literal "% of your GPA" claim. Null when every item in the week has an unset weight. */
  totalWeightPct: number | null;
  overflow: boolean;
}

export interface CourseLoadForecast {
  weeks: ForecastWeek[];
  /** False when every week in the horizon is empty — the caller's signal to show an honest empty state instead of an all-zero grid. */
  hasAnyUpcomingWork: boolean;
}

/**
 * `assessments` should be every class's assessments (unfiltered by date) —
 * this function does its own upcoming/excused/graded filtering, matching
 * the SAME "null-is-never-zero, excused rows are omitted entirely" rules
 * `lib/school/grades/grade-ledger.ts` already established for this table,
 * so the two features can never silently disagree about what an
 * assessment row means.
 */
export function computeCourseLoadForecast(assessments: ForecastableAssessment[], todayStr: string): CourseLoadForecast {
  const upcoming = assessments.filter((a) => !a.isExcused && a.pointsEarned === null && a.date >= todayStr);

  const horizonStart = getWeekStartDate(todayStr);
  const weeks: ForecastWeek[] = [];
  let hasAnyUpcomingWork = false;

  for (let i = 0; i < FORECAST_HORIZON_WEEKS; i++) {
    const weekStart = addDaysToDateString(horizonStart, i * 7);
    const weekEndExclusive = addDaysToDateString(weekStart, 7);
    const weekAssessments = upcoming.filter((a) => a.date >= weekStart && a.date < weekEndExclusive);

    const items: ForecastItem[] = weekAssessments
      .map((a) => ({
        id: a.id,
        name: a.name,
        className: a.className,
        date: a.date,
        weightPct: a.weightPct,
        heavy: a.weightPct !== null && a.weightPct >= HEAVY_WEIGHT_PCT_THRESHOLD,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const weighted = items.filter((it) => it.weightPct !== null);
    const totalWeightPct = weighted.length > 0 ? weighted.reduce((sum, it) => sum + (it.weightPct as number), 0) : null;
    const heavyItemCount = items.filter((it) => it.heavy).length;

    if (items.length > 0) hasAnyUpcomingWork = true;

    weeks.push({
      weekStart,
      items,
      itemCount: items.length,
      heavyItemCount,
      totalWeightPct,
      overflow: items.length >= OVERFLOW_ITEM_COUNT_THRESHOLD || heavyItemCount >= OVERFLOW_HEAVY_ITEM_THRESHOLD,
    });
  }

  return { weeks, hasAnyUpcomingWork };
}
