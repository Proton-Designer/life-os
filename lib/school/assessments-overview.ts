import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAssessmentType, type AssessmentType } from "@/lib/school/assessment-types";

/**
 * SCHOOL-01: the Assessments module's reader. Every upcoming assessment across the user's classes, grouped by
 * how soon it arrives. Reads class_assessments (the single source of truth the add/update/remove actions write,
 * paired with a task), never the tasks list. Not "server-only": the grouping helpers are pure and shared with
 * the module's UI; the reader takes the Supabase client like every other lib reader.
 */

/** Soon = 0..7 days away, Upcoming = 8..30, Future = 31+. The ONE place these boundaries live. */
export const SOON_MAX_DAYS = 7;
export const UPCOMING_MAX_DAYS = 30;

export type AssessmentGroup = "soon" | "upcoming" | "future";

export type AssessmentOverviewItem = {
  id: string;
  classId: string;
  className: string;
  name: string;
  /** Legacy 'final_midterm' is reported as 'exam'. */
  type: AssessmentType;
  /** YYYY-MM-DD, the user's local calendar date. */
  date: string;
  /** Whole calendar days from today (0 = today). */
  daysUntil: number;
  weightPct: number | null;
  /** The paired task (kept in sync by the write path), or null. */
  taskId: string | null;
};

/** A syllabus/announcement item waiting for a date: it cannot be an assessment yet (class_assessments.date is NOT NULL). */
export type UndatedAssessmentItem = { id: string; classId: string; className: string; name: string; type: AssessmentType };

export type AssessmentsOverview = {
  soon: AssessmentOverviewItem[];
  upcoming: AssessmentOverviewItem[];
  future: AssessmentOverviewItem[];
  noDate: UndatedAssessmentItem[];
  total: number;
};

/** Whole calendar days between two YYYY-MM-DD strings (UTC arithmetic on dates, so no DST/timezone drift). */
export function daysBetweenDates(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function groupForDaysUntil(daysUntil: number): AssessmentGroup {
  if (daysUntil <= SOON_MAX_DAYS) return "soon";
  if (daysUntil <= UPCOMING_MAX_DAYS) return "upcoming";
  return "future";
}

/** "Today", "Tomorrow", "In 5 days". */
export function daysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `In ${daysUntil} days`;
}

/** Pure grouping: assessments dated before `today` are dropped; each group is sorted by date, then class, then name. */
export function buildAssessmentsOverview(
  rows: ReadonlyArray<{ id: string; classId: string; className: string; name: string; type: AssessmentType; date: string; weightPct: number | null; taskId: string | null }>,
  today: string,
  noDate: UndatedAssessmentItem[] = []
): AssessmentsOverview {
  const items = rows
    .map((r) => ({ ...r, type: normalizeAssessmentType(r.type), daysUntil: daysBetweenDates(today, r.date) }))
    .filter((r) => r.daysUntil >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
  const out: AssessmentsOverview = { soon: [], upcoming: [], future: [], noDate, total: items.length + noDate.length };
  for (const it of items) out[groupForDaysUntil(it.daysUntil)].push(it);
  return out;
}

/**
 * `today` is the user's LOCAL date (resolve it with localDateString(now, tz); the timezone is not needed here).
 * Two small reads plus the staging items still missing a date.
 */
export async function getAssessmentsOverview(supabase: SupabaseClient, userId: string, today: string): Promise<AssessmentsOverview> {
  const { data: classRows, error: classError } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId);
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return buildAssessmentsOverview([], today);
  const classNameById = new Map(classes.map((c) => [c.id as string, ((c.short_name as string | null) ?? (c.code as string)) as string]));
  const classIds = classes.map((c) => c.id as string);

  const [assessmentRes, batchRes] = await Promise.all([
    supabase
      .from("class_assessments")
      .select("id, class_id, name, type, date, weight_pct, task_id")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .gte("date", today)
      .order("date", { ascending: true }),
    // Two plain reads + an in-memory join (no embedded select: the codebase has no precedent for that syntax).
    supabase.from("staging_batches").select("id, class_id").eq("user_id", userId).in("class_id", classIds),
  ]);
  if (assessmentRes.error) throw assessmentRes.error;
  if (batchRes.error) throw batchRes.error;

  const rows = (assessmentRes.data ?? []).map((a) => ({
    id: a.id as string,
    classId: a.class_id as string,
    className: classNameById.get(a.class_id as string) ?? "",
    name: a.name as string,
    type: a.type as AssessmentType,
    date: a.date as string,
    weightPct: (a.weight_pct as number | null) ?? null,
    taskId: (a.task_id as string | null) ?? null,
  }));

  const noDate: UndatedAssessmentItem[] = [];
  const batches = batchRes.data ?? [];
  if (batches.length > 0) {
    const classByBatch = new Map(batches.map((b) => [b.id as string, b.class_id as string]));
    const { data: staged, error: stagedError } = await supabase
      .from("staged_deliverables")
      .select("id, batch_id, name, type")
      .eq("user_id", userId)
      .in("batch_id", [...classByBatch.keys()])
      .is("date", null)
      .is("committed_assessment_id", null);
    if (stagedError) throw stagedError;
    for (const s of staged ?? []) {
      const classId = classByBatch.get(s.batch_id as string);
      if (!classId) continue;
      noDate.push({ id: s.id as string, classId, className: classNameById.get(classId) ?? "", name: s.name as string, type: normalizeAssessmentType(s.type as AssessmentType) });
    }
  }
  return buildAssessmentsOverview(rows, today, noDate);
}
