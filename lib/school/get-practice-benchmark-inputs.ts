import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BenchmarkableAssessment } from "@/lib/school/practice-vs-real-benchmark";

/**
 * P3-12 — a lean read for computePracticeVsRealBenchmark, same "own query,
 * not a second fetch of getClassCards' full shape" reasoning
 * get-forecastable-assessments.ts (P3-10) already gives.
 *
 * "GRADED" -- points_earned !== null, same convention this run's own P2-10
 * fix (460ea55) and P2-21's Canvas grade sync both already established
 * (never points_possible, which a structured sync can set before a grade
 * exists). points_possible must ALSO be a positive number to compute a
 * percentage -- a graded row with no recorded possible-points (malformed,
 * shouldn't happen given class_assessments' own writers, but not assumed
 * impossible) is excluded rather than divided-by-zero or shown as a
 * meaningless number.
 */
export async function getPracticeBenchmarkInputs(supabase: SupabaseClient, userId: string): Promise<BenchmarkableAssessment[]> {
  const { data: classRows, error: classError } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId);
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return [];
  const classNameById = new Map(classes.map((c) => [c.id as string, (c.short_name as string | null) ?? (c.code as string)]));
  const classIds = classes.map((c) => c.id as string);

  const { data: assessmentRows, error: assessmentError } = await supabase
    .from("class_assessments")
    .select("id, class_id, name, date, points_earned, points_possible")
    .eq("user_id", userId)
    .in("class_id", classIds)
    .not("points_earned", "is", null);
  if (assessmentError) throw assessmentError;

  const graded = (assessmentRows ?? []).filter((a) => typeof a.points_possible === "number" && a.points_possible > 0);
  if (graded.length === 0) return [];
  const assessmentIds = graded.map((a) => a.id as string);

  const { data: practiceRows, error: practiceError } = await supabase
    .from("practice_tests")
    .select("assessment_id, interval_label, score_pct")
    .eq("user_id", userId)
    .in("assessment_id", assessmentIds)
    .eq("status", "completed")
    .not("score_pct", "is", null);
  if (practiceError) throw practiceError;

  const completedByAssessment = new Map<string, { intervalLabel: string; scorePct: number }[]>();
  for (const p of practiceRows ?? []) {
    const list = completedByAssessment.get(p.assessment_id as string) ?? [];
    list.push({ intervalLabel: p.interval_label as string, scorePct: Number(p.score_pct) });
    completedByAssessment.set(p.assessment_id as string, list);
  }

  return graded.map((a) => ({
    assessmentId: a.id as string,
    assessmentName: a.name as string,
    className: classNameById.get(a.class_id as string) ?? "",
    date: a.date as string,
    realPct: (Number(a.points_earned) / Number(a.points_possible)) * 100,
    completedPracticeTests: completedByAssessment.get(a.id as string) ?? [],
  }));
}
