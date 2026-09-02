import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { weekDatesFrom } from "@/lib/date-utils";
import { buildAssessmentRiskInput } from "@/lib/school/risk/build-assessment-risk-input";
import { computeAssignmentRisk, type RiskBand } from "@/lib/school/risk/assignment-risk";
import type { Confidence } from "@/lib/school/risk/types";

// `difficulty_rating` / `confidence_rating` / `target_grade_pct` (classes) and
// `weight_pct` (class_assessments) landed in migration 105 — see that file's own
// comment for why every one of them is nullable by design. database.types.ts was
// regenerated from production in 8eda53c, so the `.select(...)` strings below are now
// checked against the real schema directly (a renamed/retyped column fails THIS file to
// compile, no separate Pick/`.returns<T>()` workaround needed anymore).

export type ClassCardData = {
  id: string;
  /** Ayman's own abbreviation, hand-seeded per class — falls back to `code`
   * everywhere it's displayed. A class added later (or before the Lead's
   * hand-seed lands) has this null; that is the normal, expected shape,
   * not an error state. */
  shortName: string | null;
  code: string;
  room: string | null;
  instructor: string | null;
  hasSyllabus: boolean;
  tasksDueThisWeek: number;
  upcomingAssessment: { name: string; date: string } | null;
  /** `classes.difficulty_rating` (migration 105). Null for every class until a rating
   * capture UI exists — that's expected, not an error state. Gates whether the
   * assessments list below is risk-ranked or date-ranked (see class-assessments.tsx). */
  difficultyRating: number | null;
  /** `classes.target_grade_pct` (migration 105). Null until the user sets a target —
   * the required-score verdict (lib/school/grades/requiredScore.ts) must show no
   * number at all in that case, never a fabricated one. */
  targetGradePct: number | null;
  /** All of this class's assessments, date ascending — carried alongside
   * `upcomingAssessment` (still derived from this same array, not a
   * separate query) so the expanded class view can render its full list
   * without a second round-trip once it opens (item A2). Stays date-ascending
   * here regardless of risk — `upcomingAssessment` below relies on that order
   * to find the nearest one; risk-ranking for display is the caller's job
   * (class-detail-dialog.tsx / class-assessments.tsx), not this function's. */
  assessments: {
    id: string;
    name: string;
    type: string;
    date: string;
    taskId: string | null;
    /** Always computed, even with every risk input null — the engine degrades
     * gracefully (DOMAIN_ENGINE_SPEC.md §0) rather than needing this to be optional.
     * `confidence` (R28) is what class-assessments.tsx actually ranks on, not a boolean
     * proxy — an `insufficient`-confidence score isn't a rank claim regardless of its
     * numeric value. */
    risk: { score: number; band: RiskBand; confidence: Confidence };
    /** `weight_pct`/`points_earned`/`points_possible`/`is_excused` (migrations 105/106) —
     * unlike every other field on this row, these (points/excused) are genuinely
     * per-assessment, not a class-level rating applied uniformly. Feed straight into
     * `toAssessmentGradeRows` (lib/school/grades/build-grade-rows.ts) alongside
     * `weightPct`; do not default or coalesce here — null-is-never-zero is enforced at
     * that boundary. */
    weightPct: number | null;
    pointsEarned: number | null;
    pointsPossible: number | null;
    isExcused: boolean;
  }[];
  /** This class's incomplete tasks, regardless of week — deliberately
   * wider than `tasksDueThisWeek`'s this-week/incomplete filter, since the
   * expanded class view's task list isn't scoped to the week the way the
   * card's own count is. */
  tasks: {
    id: string;
    title: string;
    dueDate: string | null;
    taskType: string | null;
    taskTypeOtherLabel: string | null;
    classId: string | null;
  }[];
};

/**
 * Shapes the School screen's classes grid (item 6b) from three tables —
 * classes, tasks (filtered by class_id and this week's due_date, B's 050),
 * and class_assessments (nearest date >= today) — into one render-ready
 * array per class. Pure data shaping, no rendering: components/school/
 * class-card.tsx takes the result as a prop, same split as
 * WeekCalendarView/HabitBuilder elsewhere in this app.
 *
 * Lin Alg (MATH 2418, item 6 spec) is the real null-path case this
 * function must get right generally, not as a special case: zero linked
 * schedule_events, null room/instructor, zero tasks, zero assessments —
 * every class added through a future editor before its details are filled
 * in will hit this identical shape.
 */
export async function getClassCards(
  supabase: SupabaseClient<Database>,
  userId: string,
  weekStart: string,
  todayStr: string
): Promise<ClassCardData[]> {
  const weekDates = weekDatesFrom(weekStart);
  const weekEnd = weekDates[weekDates.length - 1];

  const { data: classRows, error: classError } = await supabase
    .from("classes")
    .select("id, short_name, code, room, instructor, syllabus_path, difficulty_rating, confidence_rating, target_grade_pct")
    .eq("user_id", userId)
    .order("position", { ascending: true, nullsFirst: false })
    .order("code", { ascending: true });
  if (classError) throw classError;
  const classes = classRows ?? [];
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);

  // Widened from "this week, incomplete" to "all incomplete" so the
  // expanded class view (opened via ClassCard's View button) can render
  // its full task list from THIS same query — no second round-trip once
  // the dialog opens (item A2, kills the open-then-load waterfall).
  // `tasksDueThisWeek` and `upcomingAssessment` stay derived in-memory
  // from these same rows, not separate narrower queries.
  const [{ data: taskRows, error: taskError }, { data: assessmentRows, error: assessmentError }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, task_type, task_type_other_label, class_id")
      .eq("user_id", userId)
      .eq("completed", false)
      .in("class_id", classIds),
    supabase
      .from("class_assessments")
      .select("id, class_id, name, type, date, task_id, weight_pct, points_earned, points_possible, is_excused")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("date", { ascending: true }),
  ]);
  if (taskError) throw taskError;
  if (assessmentError) throw assessmentError;

  const tasksByClass = new Map<string, ClassCardData["tasks"]>();
  for (const t of taskRows ?? []) {
    if (!t.class_id) continue;
    const list = tasksByClass.get(t.class_id) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      taskType: t.task_type,
      taskTypeOtherLabel: t.task_type_other_label,
      classId: t.class_id,
    });
    tasksByClass.set(t.class_id, list);
  }

  type RawAssessment = {
    id: string;
    name: string;
    type: string;
    date: string;
    taskId: string | null;
    weightPct: number | null;
    pointsEarned: number | null;
    pointsPossible: number | null;
    isExcused: boolean;
  };
  const assessmentsByClass = new Map<string, RawAssessment[]>();
  for (const a of assessmentRows ?? []) {
    const list = assessmentsByClass.get(a.class_id) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      type: a.type,
      date: a.date,
      taskId: a.task_id,
      weightPct: a.weight_pct,
      pointsEarned: a.points_earned,
      pointsPossible: a.points_possible,
      isExcused: a.is_excused,
    });
    assessmentsByClass.set(a.class_id, list);
  }

  return classes.map((c) => {
    const tasks = tasksByClass.get(c.id) ?? [];
    const rawAssessments = assessmentsByClass.get(c.id) ?? [];
    // computeAssignmentRisk is pure and per-assessment; this class's own ratings apply to
    // every one of its assessments identically (difficulty/confidence are properties of
    // the class, migration 105), so only weightPct and date vary assessment-to-assessment.
    const assessments = rawAssessments.map((a) => {
      const riskInput = buildAssessmentRiskInput({
        today: todayStr,
        dueDate: a.date,
        weightPct: a.weightPct,
        difficultyRating: c.difficulty_rating,
        confidenceRating: c.confidence_rating,
        targetGradePct: c.target_grade_pct,
      });
      const { score, band, confidence } = computeAssignmentRisk(riskInput);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        date: a.date,
        taskId: a.taskId,
        risk: { score, band, confidence },
        weightPct: a.weightPct,
        pointsEarned: a.pointsEarned,
        pointsPossible: a.pointsPossible,
        isExcused: a.isExcused,
      };
    });
    // Rows are already ordered by date ascending (risk is attached in place, not
    // re-sorted), so the first future assessment is still the nearest upcoming one — no
    // separate min() pass. Display-order risk-ranking is the caller's job (see
    // class-assessments.tsx's `rankedByRisk`), not this function's.
    const upcomingAssessment = assessments.find((a) => a.date >= todayStr) ?? null;
    return {
      id: c.id,
      shortName: c.short_name,
      code: c.code,
      room: c.room,
      instructor: c.instructor,
      difficultyRating: c.difficulty_rating,
      targetGradePct: c.target_grade_pct,
      hasSyllabus: c.syllabus_path !== null,
      tasksDueThisWeek: tasks.filter((t) => t.dueDate !== null && t.dueDate >= weekStart && t.dueDate <= weekEnd).length,
      upcomingAssessment: upcomingAssessment ? { name: upcomingAssessment.name, date: upcomingAssessment.date } : null,
      assessments,
      tasks,
    };
  });
}
