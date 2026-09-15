import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForecastableAssessment } from "@/lib/school/course-load-forecast";

/**
 * P3-10 — a LEAN read for computeCourseLoadForecast (lib/school/
 * course-load-forecast.ts, P2-10), for callers that don't already have
 * classCards in hand the way app/(app)/school/page.tsx does (that page
 * reuses classCards directly rather than calling this — see that page's
 * own P2-10 comment). The Weekly Review page has no reason to pay for
 * getClassCards' full shape (lecture recordings, staging batches, question
 * counts, ...) just to render one forecast panel, so this queries only
 * `classes` (for the display name) and `class_assessments` (the forecast's
 * own input columns) — same two-query-then-join-in-JS shape
 * getClassCards itself uses for the identical pair of tables.
 *
 * Unfiltered by date -- computeCourseLoadForecast does its own upcoming/
 * excused/graded filtering (its own header states this explicitly), so
 * this function hands it every assessment rather than risk a second,
 * possibly-mismatched date boundary.
 */
export async function getForecastableAssessments(supabase: SupabaseClient, userId: string): Promise<ForecastableAssessment[]> {
  const { data: classRows, error: classError } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId);
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return [];

  const classNameById = new Map(classes.map((c) => [c.id as string, (c.short_name as string | null) ?? (c.code as string)]));
  const classIds = classes.map((c) => c.id as string);

  const { data: assessmentRows, error: assessmentError } = await supabase
    .from("class_assessments")
    .select("id, class_id, name, date, weight_pct, points_earned, is_excused")
    .eq("user_id", userId)
    .in("class_id", classIds);
  if (assessmentError) throw assessmentError;

  return (assessmentRows ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    className: classNameById.get(a.class_id as string) ?? "",
    date: a.date as string,
    weightPct: a.weight_pct as number | null,
    pointsEarned: a.points_earned as number | null,
    isExcused: a.is_excused as boolean,
  }));
}
