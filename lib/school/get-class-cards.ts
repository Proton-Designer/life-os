import { untypedFrom } from "@/lib/self-mastery/untyped-from";
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
  /**
   * CANVAS-GAP-01 -- Canvas's OWN instructor-computed course grade, a
   * snapshot as of `syncedAt`, DISPLAY-ONLY. `null` when this class has no
   * Canvas link at all (never fabricated). When linked, an object whose
   * three score fields are independently nullable too (Canvas itself
   * reports nothing for a course/enrollment it doesn't compute one for --
   * never coalesced to 0). Never read by risk/load/benchmark math, which
   * all key off `assessments[].pointsEarned` instead -- this field must
   * never be threaded into that path.
   */
  canvasComputedGrade: { currentScore: number | null; finalScore: number | null; currentLetterGrade: string | null; syncedAt: string } | null;
  /** CANVAS-GAP-02 -- true when this class has ANY canvas_course_mappings row, independent of whether a computed grade has ever synced. Drives whether SyllabusPanel offers "Import from Canvas" alongside the existing manual PDF upload. */
  canvasLinked: boolean;
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
  /** Phase 1 #16/#18 — this class's most recent NOT-YET-CONFIRMED staging batch
   * (syllabus extraction), or null when there is none. Null covers three real,
   * distinct states identically: never extracted, already confirmed (nothing left
   * to review), or a batch whose extraction produced no batch at all (no_key/
   * unreadable/etc. — see syllabus-extraction-actions.ts, which never creates a
   * row for those). Only one batch is ever surfaced per class — a second upload
   * while one is still pending isn't part of this pass's scope. */
  pendingStagingBatch: {
    id: string;
    /** P2-07: "syllabus" or "announcement" -- which upload/paste this batch came from, so the review panel can show the right heading. */
    source: string;
    deliverables: {
      id: string;
      name: string;
      type: string;
      date: string | null;
      confidence: number;
      sourceSnippet: string | null;
      /** Set when this row is a CHANGE to an assessment the person already has (a Canvas due date that moved): the date it has now. Confirming moves it instead of adding a second one. */
      movesFrom?: string | null;
    }[];
  } | null;
  /** P3-14 -- this class's lecture recordings, most recent first. Actual
   * audio bytes are never here -- only lecture-actions.ts's
   * `getLectureRecordingUrl` mints a signed URL, on demand, per play.
   * P3-15 adds transcriptStatus/transcriptText/transcriptError -- 'none'
   * means no transcription has ever been requested for this recording, the
   * normal starting state, not an error. */
  lectures: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    durationSeconds: number | null;
    createdAt: string;
    transcriptStatus: "none" | "queued" | "processing" | "completed" | "failed";
    transcriptText: string | null;
    transcriptError: string | null;
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
    { data: batchRows, error: batchError },
    { data: lectureRows, error: lectureError },
    { data: canvasGradeRows, error: canvasGradeError },
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
    // Phase 1 #16/#18 — only one pending batch per class is surfaced (see
    // ClassCardData.pendingStagingBatch's own comment); ordering desc + picking the
    // first per class below is enough, no LIMIT-per-group query needed for this scale.
    supabase
      .from("staging_batches")
      .select("id, class_id, source")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .neq("status", "confirmed")
      .order("created_at", { ascending: false }),
    // P3-14 -- see lecture-actions.ts. Migration 211 is applied and typed
    // (database.types.ts regenerated in 234ecb1), so this is a plain typed
    // query like every other one in this file.
    supabase
      .from("lecture_recordings")
      .select("id, class_id, original_filename, mime_type, size_bytes, duration_seconds, created_at")
      .eq("user_id", userId)
      .in("class_id", classIds)
      .order("created_at", { ascending: false }),
    // CANVAS-GAP-01 -- Canvas's own instructor-computed course grade,
    // display-only (never joined against class_assessments/points_earned
    // anywhere in this file or its callers).
    supabase
      .from("canvas_course_mappings")
      .select("class_id, computed_current_score, computed_final_score, computed_current_letter_grade, computed_grade_synced_at")
      .eq("user_id", userId)
      .in("class_id", classIds),
  ]);
  if (taskError) throw taskError;
  if (assessmentError) throw assessmentError;
  if (questionError) throw questionError;
  if (categoryError) throw categoryError;
  if (batchError) throw batchError;
  if (lectureError) throw lectureError;
  if (canvasGradeError) throw canvasGradeError;

  // Dependent on batchRows resolving first (which batch ids exist), so this can't join
  // the Promise.all wave above — same "the next query needs the prior one's ids" shape
  // schedule_events/cancelledDates already has in app/(app)/school/page.tsx.
  const pendingBatchIdByClass = new Map<string, string>();
  // P2-07: threaded through alongside the id so the review panel can show
  // the right heading ("Syllabus" vs "Announcement") -- which batch is
  // picked as "pending" is completely unchanged.
  const pendingBatchSourceByClass = new Map<string, string>();
  for (const b of batchRows ?? []) {
    if (!pendingBatchIdByClass.has(b.class_id)) {
      pendingBatchIdByClass.set(b.class_id, b.id); // desc order -> first seen is most recent
      pendingBatchSourceByClass.set(b.class_id, b.source);
    }
  }
  const pendingBatchIds = [...pendingBatchIdByClass.values()];
  const { data: deliverableRows, error: deliverableError } =
    pendingBatchIds.length === 0
      ? { data: [] as { id: string; batch_id: string; name: string; type: string; date: string | null; confidence: number; source_snippet: string | null; replaces_assessment_id?: string | null }[], error: null }
      : // replaces_assessment_id (migration 282) is not in the generated types yet, so this one read goes through the untyped helper.
        await untypedFrom(supabase, "staged_deliverables")
          .select("id, batch_id, name, type, date, confidence, source_snippet, replaces_assessment_id")
          .eq("user_id", userId)
          .in("batch_id", pendingBatchIds)
          .is("committed_assessment_id", null)
          .order("created_at", { ascending: true })
          .returns<{ id: string; batch_id: string; name: string; type: string; date: string | null; confidence: number; source_snippet: string | null; replaces_assessment_id?: string | null }[]>();
  if (deliverableError) throw deliverableError;

  // The current date of every assessment a pending change would move, so the review can say "moves from <date>".
  const replacedIds = [...new Set((deliverableRows ?? []).map((d) => d.replaces_assessment_id).filter((id): id is string => !!id))];
  const movesFromById = new Map<string, string>();
  if (replacedIds.length > 0) {
    const { data: replacedRows } = await supabase.from("class_assessments").select("id, date").eq("user_id", userId).in("id", replacedIds);
    for (const r of (replacedRows ?? []) as { id: string; date: string }[]) movesFromById.set(r.id, r.date);
  }

  type PendingDeliverable = NonNullable<ClassCardData["pendingStagingBatch"]>["deliverables"][number];
  const deliverablesByBatch = new Map<string, PendingDeliverable[]>();
  for (const d of deliverableRows) {
    const list = deliverablesByBatch.get(d.batch_id) ?? [];
    list.push({
      id: d.id,
      name: d.name,
      type: d.type,
      date: d.date,
      confidence: d.confidence,
      sourceSnippet: d.source_snippet,
      movesFrom: d.replaces_assessment_id ? (movesFromById.get(d.replaces_assessment_id) ?? null) : null,
    });
    deliverablesByBatch.set(d.batch_id, list);
  }

  // P3-15 -- dependent on lectureRows resolving first (which recording ids
  // exist), same "next query needs the prior one's ids" shape as the
  // staging-batch/deliverables pair above.
  const lectureIds = (lectureRows ?? []).map((l) => l.id);
  const { data: transcriptRows, error: transcriptError } =
    lectureIds.length === 0
      ? { data: [] as { recording_id: string; status: string; transcript_text: string | null; error_message: string | null }[], error: null }
      : await supabase
          .from("lecture_transcripts")
          .select("recording_id, status, transcript_text, error_message")
          .eq("user_id", userId)
          .in("recording_id", lectureIds);
  if (transcriptError) throw transcriptError;

  type TranscriptStatus = ClassCardData["lectures"][number]["transcriptStatus"];
  const transcriptByRecording = new Map<string, { status: TranscriptStatus; text: string | null; error: string | null }>();
  for (const t of transcriptRows) {
    transcriptByRecording.set(t.recording_id, {
      status: t.status as TranscriptStatus,
      text: t.transcript_text,
      error: t.error_message,
    });
  }

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

  // CANVAS-GAP-01 -- at most one canvas_course_mappings row per class_id
  // in practice (a class is adopted/created by exactly one Canvas course),
  // so a plain Map (last-wins) is fine, not a per-class array like the
  // maps above.
  const canvasComputedGradeByClass = new Map<string, NonNullable<ClassCardData["canvasComputedGrade"]>>();
  // CANVAS-GAP-02 -- a row's mere PRESENCE here means this class is
  // Canvas-linked, regardless of whether a computed-grade snapshot has
  // ever synced (a class linked via the ICS-feed/agent-import paths, or
  // one whose course happens to report no computed grade at all, is still
  // linked) -- drives whether the Syllabus panel offers "Import from Canvas".
  const canvasLinkedClassIds = new Set<string>();
  for (const g of canvasGradeRows ?? []) {
    if (!g.class_id) continue;
    canvasLinkedClassIds.add(g.class_id);
    if (!g.computed_grade_synced_at) continue;
    canvasComputedGradeByClass.set(g.class_id, {
      currentScore: g.computed_current_score,
      finalScore: g.computed_final_score,
      currentLetterGrade: g.computed_current_letter_grade,
      syncedAt: g.computed_grade_synced_at,
    });
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

  const lecturesByClass = new Map<string, ClassCardData["lectures"]>();
  for (const l of lectureRows ?? []) {
    const list = lecturesByClass.get(l.class_id) ?? [];
    const transcript = transcriptByRecording.get(l.id);
    list.push({
      id: l.id,
      originalFilename: l.original_filename,
      mimeType: l.mime_type,
      sizeBytes: l.size_bytes,
      durationSeconds: l.duration_seconds,
      createdAt: l.created_at,
      transcriptStatus: transcript?.status ?? "none",
      transcriptText: transcript?.text ?? null,
      transcriptError: transcript?.error ?? null,
    });
    lecturesByClass.set(l.class_id, list);
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
      canvasComputedGrade: canvasComputedGradeByClass.get(c.id) ?? null,
      canvasLinked: canvasLinkedClassIds.has(c.id),
      tasksDueThisWeek: tasks.filter((t) => t.dueDate !== null && t.dueDate >= weekStart && t.dueDate <= weekEnd).length,
      upcomingAssessment: upcomingAssessment ? { name: upcomingAssessment.name, date: upcomingAssessment.date } : null,
      assessments,
      categories: categoriesByClass.get(c.id) ?? [],
      tasks,
      questions: questionsByClass.get(c.id) ?? [],
      pendingStagingBatch: pendingBatchIdByClass.has(c.id)
        ? {
            id: pendingBatchIdByClass.get(c.id)!,
            source: pendingBatchSourceByClass.get(c.id)!,
            deliverables: deliverablesByBatch.get(pendingBatchIdByClass.get(c.id)!) ?? [],
          }
        : null,
      lectures: lecturesByClass.get(c.id) ?? [],
    };
  });
}
