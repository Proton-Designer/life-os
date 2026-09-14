import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { dayOfWeekFromDateString } from "@/lib/date-utils";
import { buildAssessmentRiskInput } from "@/lib/school/risk/build-assessment-risk-input";
import { computeAssignmentRisk, type RiskBand } from "@/lib/school/risk/assignment-risk";

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
 * Phase 1 #15 — the day-level "School Today" feed: every assessment due on `targetDate`,
 * risk-ranked, across every class. One implementation, two callers (Opus Lead ruling):
 * - `/school` passes `targetDate === todayStr` — "what does school look like today."
 * - #28 (Night Plan seam, an EVENING ritual that plans tomorrow) will pass `targetDate`
 *   = tomorrow's date — the inventory names "School Today feed → Night Plan" as the
 *   consumer, and a nightly plan is for the day ahead, not the day already closing.
 *
 * `todayStr` and `targetDate` are DELIBERATELY separate parameters, not one date reused
 * for both roles: `todayStr` feeds the risk engine's own proximity factor (how urgent
 * something is relative to the actual moment "now"), while `targetDate` selects which
 * day's assessments to show. Collapsing them would make a Night-Plan item due tomorrow
 * read as due TODAY the moment #28 calls this with `targetDate` = tomorrow — proximity
 * would max out a full day early. `get-class-cards.ts` keeps this exact separation
 * (`today: todayStr, dueDate: a.date`) for the identical reason; this file follows it.
 *
 * Both dates must already be resolved through a timezone by the caller — `localDateString
 * (now, tz)` for `todayStr`, and `addDaysToDateString(todayStr, 1)` (or equivalent) for a
 * caller wanting tomorrow — never a raw `Date`/UTC value (AGENTS.md).
 *
 * Queries directly rather than reusing `getClassCards`, which this file has no reason to
 * depend on (it fetches tasks/questions/syllabus this feed never touches) and which #28's
 * caller — outside the School domain entirely — has no reason to have already computed.
 * Two narrow queries + an in-memory join, the same shape `get-class-cards.ts` itself uses
 * rather than a nested/embedded select (no precedent for that syntax anywhere in this
 * codebase).
 */
export async function getSchoolTodayFeed(
  supabase: SupabaseClient<Database>,
  userId: string,
  todayStr: string,
  targetDate: string
): Promise<SchoolTodayItem[]> {
  const [{ data: assessmentRows, error: assessmentError }, { data: classRows, error: classError }] = await Promise.all([
    supabase
      .from("class_assessments")
      .select("id, class_id, name, date, weight_pct")
      .eq("user_id", userId)
      .eq("date", targetDate),
    supabase.from("classes").select("id, code, difficulty_rating, confidence_rating, target_grade_pct").eq("user_id", userId),
  ]);
  if (assessmentError) throw assessmentError;
  if (classError) throw classError;
  if (!assessmentRows || assessmentRows.length === 0) return [];

  const classById = new Map((classRows ?? []).map((c) => [c.id, c]));
  const weekday = WEEKDAY_SHORT[dayOfWeekFromDateString(targetDate)];

  const items: SchoolTodayItem[] = assessmentRows.map((a) => {
    const cls = classById.get(a.class_id);
    const riskInput = buildAssessmentRiskInput({
      today: todayStr,
      dueDate: a.date,
      weightPct: a.weight_pct,
      difficultyRating: cls?.difficulty_rating ?? null,
      confidenceRating: cls?.confidence_rating ?? null,
      targetGradePct: cls?.target_grade_pct ?? null,
    });
    const { score, band } = computeAssignmentRisk(riskInput);
    return {
      id: a.id,
      title: `${cls?.code ?? "?"} · ${a.name} · due ${weekday}`,
      dueDate: a.date,
      risk: { score, band },
    };
  });

  return items.sort((a, b) => b.risk.score - a.risk.score);
}
