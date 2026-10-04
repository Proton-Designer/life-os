import Link from "next/link";
import { KIND_LABEL, type WorkSessionKind } from "@/lib/business/work-session-kind";
import { formatHoursMinutes } from "@/lib/evening-close/format-hours";
import type { HoursByKind } from "@/lib/evening-close/hours-today";
import type { ParetoBar } from "@/lib/weekly-review/pareto";
import type { HabitWeeklySummary } from "@/lib/weekly-review/habit-summary";
import type { EfficiencyByClosedDay } from "@/lib/day-structure/closed-day";

/**
 * The Weekly Review screen (#46/#47/#48) — a pure Server Component, no
 * client interactivity: the "This week so far" toggle is two plain `Link`s
 * to `?view=so-far` / the bare route, not client state, since nothing on
 * this page is ever edited from here.
 *
 * Reuses `KIND_LABEL` (lib/business/work-session-kind.ts) rather than
 * inventing a second label set for deep_work/deep_study/learn — that file's
 * own header already settled "Recall," not "Review," for `learn` to avoid
 * colliding with /close's own "Review" nav label, which the ruling for
 * this feature independently ran into from the other direction (this
 * screen could not be called "/review" for exactly that same collision).
 *
 * "Hours" CORRECTED 2026-09-15: the bars are ONLY the counting kinds
 * (deep_work/deep_study — `hours.byKind` is already `counts_toward_hours`-
 * filtered at the query, lib/evening-close/hours-today.ts's
 * getHoursByKindForRange). 'learn' does NOT get a bar inside Hours; its
 * time is a separate, clearly-labelled "Recall" line below the headline
 * (`recallMinutes`, from that file's `getEndedRecallMinutesForRange`,
 * which itself excludes any still-open session — an abandoned review must
 * never display as hours of study, the exact production bug this
 * correction exists to prevent).
 *
 * Scope guard (ruled 2026-09-14): Phase 1 is #46-48 only. No
 * efficiency-by-day, load forecast, weekly narrative, or habit pause/
 * freeze/kill-habit UI here — those are Phase 2+.
 */

const COUNTING_KIND_ORDER: WorkSessionKind[] = ["deep_work", "deep_study"];

function Bar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/**
 * P3-09: one line, not a new panel (Opus Lead's instruction). Closed days
 * get a real average (lib/day-structure/closed-day.ts's own header
 * explains why open days never get a fabricated number instead of a
 * count: no honest end-of-day anchor exists for a day that was never
 * closed). Omits the closed-days clause when there are none that week
 * (never "0% avg on 0 closed days," the same honest-absence posture as
 * this page's own narrative panel), and returns null entirely when the
 * week has neither closed nor open days to say anything real about.
 *
 * GAP-03, second half: a closedCount>0 day can still have no usable
 * average (closed-day.ts's own count/average split, f1e7075 -- e.g. a
 * close with no same-day wake mark, or an invalid wake-to-close delta).
 * Gating the whole clause on closedAvgPercent !== null made that exact
 * close invisible here even after the data layer counted it correctly --
 * the same "a real close renders as if it never happened" symptom, moved
 * from the data layer to the view layer. closedCount alone must be able
 * to render a clause.
 */
function formatEfficiencyLine(efficiency: EfficiencyByClosedDay): string | null {
  const { closedAvgPercent, closedCount, openCount } = efficiency;
  const closedClause =
    closedAvgPercent !== null
      ? `${closedAvgPercent}% avg on ${closedCount} closed day${closedCount === 1 ? "" : "s"}`
      : closedCount > 0
        ? `${closedCount} closed day${closedCount === 1 ? "" : "s"}, efficiency unavailable`
        : null;
  const openClause = openCount > 0 ? `${openCount} open day${openCount === 1 ? "" : "s"} (efficiency unavailable)` : null;
  if (closedClause && openClause) return `Efficiency: ${closedClause} · ${openClause}`;
  if (closedClause) return `Efficiency: ${closedClause}`;
  if (openClause) return `Efficiency: ${openClause}, none closed`;
  return null;
}

function HoursSection({
  totalMinutes,
  byKind,
  recallMinutes,
  efficiency,
}: {
  totalMinutes: number;
  byKind: HoursByKind;
  recallMinutes: number;
  efficiency: EfficiencyByClosedDay;
}) {
  const efficiencyLine = formatEfficiencyLine(efficiency);
  const max = Math.max(1, ...COUNTING_KIND_ORDER.map((k) => byKind[k] ?? 0));
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Hours</h2>
        <span className="text-2xl font-semibold tabular-nums">{formatHoursMinutes(totalMinutes)}</span>
      </div>
      <div className="flex flex-col gap-2">
        {COUNTING_KIND_ORDER.map((kind) => {
          const minutes = byKind[kind] ?? 0;
          return (
            <div key={kind} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{KIND_LABEL[kind]}</span>
                <span className="font-medium tabular-nums">{formatHoursMinutes(minutes)}</span>
              </div>
              <Bar pct={(minutes / max) * 100} className="bg-primary" />
            </div>
          );
        })}
      </div>
      {/* Deliberately OUTSIDE the Hours total above -- retrieval review is
          not deep-work-class time (lib/business/work-session-kind.ts's own
          KIND_LABEL comment), and a still-running review is excluded
          entirely from this figure (getEndedRecallMinutesForRange), not
          just capped, so an abandoned session can never inflate it. */}
      <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <span>{KIND_LABEL.learn} time (not counted toward Hours)</span>
        <span className="font-medium tabular-nums text-foreground">{formatHoursMinutes(recallMinutes)}</span>
      </div>
      {efficiencyLine && <p className="text-xs text-muted-foreground">{efficiencyLine}</p>}
    </section>
  );
}

function ParetoSection({ bars }: { bars: ParetoBar[] }) {
  const max = bars.length > 0 ? bars[0]!.count : 0;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <h2 className="text-sm font-medium">Distraction Pareto — every distraction since day one, by cause</h2>
      {bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No distractions logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bars.map((bar) => (
            <li key={bar.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate">{bar.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{bar.count}</span>
              </div>
              <Bar pct={max === 0 ? 0 : (bar.count / max) * 100} className="bg-accent-warning" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HabitScoreSection({ summaries, weekDayCount }: { summaries: HabitWeeklySummary[]; weekDayCount: number }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <h2 className="text-sm font-medium">Habit scores</h2>
      {summaries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active identity habits yet. <Link href="/week#habits" className="underline underline-offset-2">Start one</Link>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {summaries.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{h.identityStatement}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {h.votesThisWeek}/{weekDayCount} this week ·{" "}
                <span className="font-semibold text-foreground">{h.isNew ? "New" : `${Math.round((h.score ?? 0) * 100)}%`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WeeklyReviewView({
  soFar,
  weekDayCount,
  hours,
  recallMinutes,
  efficiency,
  pareto,
  habitSummaries,
  viewBasePath = "/insights?tab=week",
  showViewSwitch = true,
}: {
  /** Hidden on /week: the reset always reviews the most recent COMPLETED week. */
  showViewSwitch?: boolean;
  /** Where the "Last completed week / This week so far" switch points (the Insights Week tab by default). */
  viewBasePath?: string;
  soFar: boolean;
  weekDayCount: number;
  hours: { totalMinutes: number; byKind: HoursByKind };
  recallMinutes: number;
  efficiency: EfficiencyByClosedDay;
  pareto: ParetoBar[];
  habitSummaries: HabitWeeklySummary[];
}) {
  const soFarHref = `${viewBasePath}${viewBasePath.includes("?") ? "&" : "?"}view=so-far`;
  return (
    <div className="flex flex-col gap-4">
      {showViewSwitch && (
      <div className="flex gap-3 text-sm">
        <Link
          href={viewBasePath}
          aria-current={!soFar ? "page" : undefined}
          className={!soFar ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          Last completed week
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href={soFarHref}
          aria-current={soFar ? "page" : undefined}
          className={soFar ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          This week so far
        </Link>
      </div>
      )}
      <HoursSection totalMinutes={hours.totalMinutes} byKind={hours.byKind} recallMinutes={recallMinutes} efficiency={efficiency} />
      <ParetoSection bars={pareto} />
      <HabitScoreSection summaries={habitSummaries} weekDayCount={weekDayCount} />
    </div>
  );
}
