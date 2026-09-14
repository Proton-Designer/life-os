import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { weekDatesFrom } from "@/lib/date-utils";
import { buildAssessmentRiskInput } from "@/lib/school/risk/build-assessment-risk-input";
import { computeAssignmentRisk, type RiskBand } from "@/lib/school/risk/assignment-risk";
import type { Confidence } from "@/lib/school/risk/types";
import type { QuestionOrigin } from "@/lib/school/questions-core";
import { parseGradeBoundaries } from "@/lib/school/grades/parse-grade-boundaries";

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
  /** `classes.term` (migration 152, Phase 1 #11) — free text (e.g. "Fall 2026"),
   * hand-entered like room/instructor. Null until set. */
  term: string | null;
  /** `classes.late_policy`/`attendance_policy`/`allowed_absences` (migration 152,
   * Phase 1 #11) — free text/numeric, informational only, same null-until-set
   * treatment as term. */
  latePolicy: string | null;
  attendancePolicy: string | null;
  allowedAbsences: number | null;
  /** `classes.grade_boundaries` (migration 152) parsed via
   * `parseGradeBoundaries` — a custom letter-grade scale, or `[]` when unset
   * (never a fabricated default; see that column's own comment). */
  gradeBoundaries: { letter: string; minPct: number }[];
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
    /** `class_assessments.category_id` (migration 152, Phase 1 #11) — which
     * `categories` row (below) this assessment belongs to, or null when
     * uncategorized. Feeds `computeClassGrade`'s `categoryDefs` parameter
     * alongside `categories`, same as `weightPct` feeds the synthetic path. */
    categoryId: string | null;
  }[];
  /** `grade_categories` rows for this class (migration 152, Phase 1 #11) —
   * CollegeOS's real weight-category model. Empty for a class that has never
   * created one, in which case `computeClassGrade` falls back to its original
   * synthetic-per-assessment treatment entirely unchanged (see that file's
   * own header). Shape matches `GradeCategoryDefinition`
   * (lib/school/grades/grade-ledger.ts) field for field. */
  categories: {
    id: string;
    name: string;
    weightPct: number;
    dropLowestN: number;
    expectedItemCount: number;
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
  /** This class's question bank (Phase 1 #20), active and retired alike —
   * the panel itself decides what to show and hide (retired questions stay
   * visible behind a toggle, never hard-deleted; see questions-core.ts). */
  questions: {
    id: string;
    prompt: string;
    answer: string;
    topic: string | null;
    sourceAnchor: string | null;
    sourceSkipped: boolean;
    origin: QuestionOrigin;
    active: boolean;
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
    .select(
      "id, short_name, code, room, instructor, syllabus_path, difficulty_rating, confidence_rating, target_grade_pct, term, late_policy, attendance_policy, allowed_absences, grade_boundaries"
    )
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
  const [
    { data: taskRows, error: taskError },
    { data: assessmentRows, error: assessmentError },
    { data: questionRows, error: questionError },
    { data: categoryRows, error: categoryError },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_date, task_type, task_type_other_label, class_id")
      .eq("user_id", userId)
      .eq("completed", false)
      .in("class_id", classIds),
    supabase
      .from("class_assessments")
      .select("id, class_id, name, type, date, task_id, weight_pct, points_earned, points_possible, is_excused, category_id")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("date", { ascending: true }),
    supabase
      .from("questions")
      .select("id, class_id, prompt, answer, topic, source_anchor, source_skipped, origin, active")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("grade_categories")
      .select("id, class_id, name, weight_pct, drop_lowest_n, expected_item_count")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("created_at", { ascending: true }),
  ]);
  if (taskError) throw taskError;
  if (assessmentError) throw assessmentError;
  if (questionError) throw questionError;
  if (categoryError) throw categoryError;

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
    categoryId: string | null;
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
      categoryId: a.category_id,
    });
    assessmentsByClass.set(a.class_id, list);
  }

  const categoriesByClass = new Map<string, ClassCardData["categories"]>();
  for (const c of categoryRows ?? []) {
    const list = categoriesByClass.get(c.class_id) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      weightPct: c.weight_pct,
      dropLowestN: c.drop_lowest_n,
      expectedItemCount: c.expected_item_count,
    });
    categoriesByClass.set(c.class_id, list);
  }

  type RawQuestion = {
    id: string;
    prompt: string;
    answer: string;
    topic: string | null;
    sourceAnchor: string | null;
    sourceSkipped: boolean;
    origin: QuestionOrigin;
    active: boolean;
  };
  const questionsByClass = new Map<string, RawQuestion[]>();
  for (const q of questionRows ?? []) {
    const list = questionsByClass.get(q.class_id) ?? [];
    list.push({
      id: q.id,
      prompt: q.prompt,
      answer: q.answer,
      topic: q.topic,
      sourceAnchor: q.source_anchor,
      sourceSkipped: q.source_skipped,
      // Cast, same treatment class-detail-dialog.tsx gives class_assessments.type
      // (a text column with a CHECK, not a generated Postgres enum) — the CHECK
      // is the actual guarantee, this cast just names it in TypeScript's terms.
      origin: q.origin as QuestionOrigin,
      active: q.active,
    });
    questionsByClass.set(q.class_id, list);
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
        categoryId: a.categoryId,
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
      term: c.term,
      latePolicy: c.late_policy,
      attendancePolicy: c.attendance_policy,
      allowedAbsences: c.allowed_absences,
      gradeBoundaries: parseGradeBoundaries(c.grade_boundaries),
      difficultyRating: c.difficulty_rating,
      targetGradePct: c.target_grade_pct,
      hasSyllabus: c.syllabus_path !== null,
      tasksDueThisWeek: tasks.filter((t) => t.dueDate !== null && t.dueDate >= weekStart && t.dueDate <= weekEnd).length,
      upcomingAssessment: upcomingAssessment ? { name: upcomingAssessment.name, date: upcomingAssessment.date } : null,
      assessments,
      categories: categoriesByClass.get(c.id) ?? [],
      tasks,
      questions: questionsByClass.get(c.id) ?? [],
    };
  });
}
