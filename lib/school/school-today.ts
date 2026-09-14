import { dayOfWeekFromDateString } from "@/lib/date-utils";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface SchoolTodayItem {
  id: string;
  /** "CODE · Assessment name · due Thu" — three-app-feature-inventory.md's own spec for
   * this feed, verbatim. Pre-formatted here (not left to the caller) so `composeDump`'s
   * later `DumpItem.title` (Phase 1 #28) and any other consumer read the identical
   * string, rather than each caller re-deriving the same format. */
  title: string;
  dueDate: string;
  risk: { score: number; band: RiskBand };
}

/**
 * Phase 1 #15 — the day-level "School Today" feed: today's assessments, risk-ranked,
 * across every class. Deliberately DAY-scoped (`dueDate === todayStr`), not the wider
 * due-soon window `DeadlineRiskPanel` (#14) already covers — different question ("what
 * does school look like today specifically") for a different consumer (the Night Plan
 * seam, #28, which needs a short list to dump from, not a week's worth of rows).
 *
 * Pure and framework-free, like the rest of `lib/school/` — no clock read here; `todayStr`
 * is the caller's already-resolved local date (AGENTS.md's timezone rule).
 */
export function getSchoolTodayFeed(
  classCards: { code: string; assessments: { id: string; name: string; date: string; risk: { score: number; band: RiskBand } }[] }[],
  todayStr: string
): SchoolTodayItem[] {
  const weekday = WEEKDAY_SHORT[dayOfWeekFromDateString(todayStr)];
  const items: SchoolTodayItem[] = classCards.flatMap((c) =>
    c.assessments
      .filter((a) => a.date === todayStr)
      .map((a) => ({
        id: a.id,
        title: `${c.code} · ${a.name} · due ${weekday}`,
        dueDate: a.date,
        risk: a.risk,
      }))
  );
  return items.sort((a, b) => b.risk.score - a.risk.score);
}
