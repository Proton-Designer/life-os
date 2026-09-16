import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSESSMENT_TYPES, type AssessmentType } from "@/lib/school/assessment-types";

export { ASSESSMENT_TYPES, type AssessmentType };

/**
 * R5 core(supabase, userId, ...) extraction for app/(app)/school/class-actions.ts
 * — same discipline as lib/deen/actions-core.ts, lib/coop/targets-core.ts,
 * lib/coop/tasks-core.ts, lib/business/actions-core.ts. None of these call
 * requireUser()/getProfile()/getAuthedUser().
 *
 * NOT EXTRACTED HERE, DELIBERATELY:
 * - `deleteClassAssessment` (a real DELETE via the `delete_class_assessment`
 *   RPC) — the MCP write path may never hard-delete a row, same guardrail
 *   as everywhere else in this program. Stays cookie-coupled in
 *   class-actions.ts.
 * - `uploadClassSyllabus`/`removeClassSyllabus` — these take a `FormData`/
 *   `File` and talk to Supabase Storage directly, not a JSON-shaped patch;
 *   there is no sane MCP `write(patch: {...})` representation of "here is a
 *   PDF" without inventing a base64-blob convention this program has never
 *   needed anywhere else. Deliberately out of scope for this pass — see
 *   docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md.
 * - `listClassAssessments`/`listClassTasks`/`getClassSyllabusUrl` — reads,
 *   not writes; `read(domain:"school", entity:"class_assessment"/"task")`
 *   already covers the data these return (minus the signed syllabus URL,
 *   which is server-minted and short-lived by design — never a value to
 *   hand back through a generic read tool).
 */

export interface CreateClassInput {
  shortName?: string;
  code: string;
  room?: string;
  instructor?: string;
  /**
   * P4-08: the same migration-152 policy fields `UpdateClassInput` already
   * accepts, now also settable at creation time (previously only
   * available via a follow-up `updateClassCore` call). All optional and
   * additive -- every existing caller (the app's own `createClass`
   * wrapper included) that never sends these keeps working unchanged,
   * since an absent field here was already `null` at insert time before
   * this change (the column has no default either way).
   */
  term?: string | null;
  latePolicy?: string | null;
  attendancePolicy?: string | null;
  allowedAbsences?: number | null;
  gradeBoundaries?: { letter: string; minPct: number }[] | null;
}

/**
 * Same "compute position server-side as max(existing)+1" behavior as the
 * original `createClass` — null sorts last by `code` (the fallback for
 * classes that predate `position` entirely), but a class just deliberately
 * added belongs at the end of that order, not wherever `code` happens to
 * alphabetize it.
 */
export async function createClassCore(supabase: SupabaseClient, userId: string, input: CreateClassInput): Promise<string> {
  const { data: maxRow, error: maxError } = await supabase
    .from("classes")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw maxError;
  const nextPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("classes")
    .insert({
      user_id: userId,
      short_name: input.shortName ?? null,
      code: input.code,
      room: input.room ?? null,
      instructor: input.instructor ?? null,
      position: nextPosition,
      term: input.term ?? null,
      late_policy: input.latePolicy ?? null,
      attendance_policy: input.attendancePolicy ?? null,
      allowed_absences: input.allowedAbsences ?? null,
      grade_boundaries: input.gradeBoundaries ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export interface UpdateClassInput {
  shortName?: string | null;
  /**
   * CANVAS-LITE-03: `classes.code` is NOT NULL, unlike every other field
   * here -- undefined means "don't touch" (same as the rest), but the
   * caller (updateClass) must never pass an empty string; this core does
   * not re-validate that (same division of responsibility class-actions.ts
   * already has for allowedAbsences' numeric-ness).
   */
  code?: string;
  room?: string | null;
  instructor?: string | null;
  /** `classes.term` (migration 152, Phase 1 #11) -- free text, same editable-
   * after-creation treatment as shortName/room/instructor. */
  term?: string | null;
  /** `classes.late_policy`/`attendance_policy` (migration 152, Phase 1 #11) --
   * free text, informational only -- no feature computes against these, same
   * posture as term. */
  latePolicy?: string | null;
  attendancePolicy?: string | null;
  /** `classes.allowed_absences` (migration 152) -- a real count, non-negative
   * when present (the column's own CHECK); this function does not re-clamp
   * it, the caller (updateClass) is expected to have already. */
  allowedAbsences?: number | null;
  /** `classes.grade_boundaries` (migration 152) -- a jsonb array of
   * {letter, minPct}, or null for "no custom scale set." Undefined (field
   * omitted) leaves the column untouched, same convention as
   * `updateClassAssessmentCore`'s `weightPct`. */
  gradeBoundaries?: { letter: string; minPct: number }[] | null;
}

/** short_name (Opus Lead: must be editable, never seed-only), room, instructor, term, late/attendance policy, allowed absences, grade boundaries. */
export async function updateClassCore(supabase: SupabaseClient, userId: string, classId: string, input: UpdateClassInput): Promise<void> {
  const { error } = await supabase
    .from("classes")
    .update({
      short_name: input.shortName,
      code: input.code,
      room: input.room,
      instructor: input.instructor,
      term: input.term,
      late_policy: input.latePolicy,
      attendance_policy: input.attendancePolicy,
      allowed_absences: input.allowedAbsences,
      ...(input.gradeBoundaries !== undefined ? { grade_boundaries: input.gradeBoundaries } : {}),
    })
    .eq("id", classId)
    .eq("user_id", userId);
  if (error) throw error;
}

// ASSESSMENT_TYPES/AssessmentType moved to lib/school/assessment-types.ts (a client-safe
// module with no "server-only" import) -- imported and re-exported above. See that
// file's own header for why: a Client Component importing this constant as a runtime
// value straight from this server-only module broke the production build (found live
// 2026-09-15), even though tsc/vitest saw nothing wrong.

export interface AddClassAssessmentResult {
  assessmentId: string;
  taskId: string;
}

/**
 * Ruling R5: adding an assessment also creates its task, using only the
 * assessment's own fields ("we have all the information we need") — no
 * separate task-description prompt. class_id ties both the class task list
 * and the main school list to this one row with no extra sync logic.
 *
 * `date`/`type` are caller-supplied strings/enums, never derived from
 * `new Date()` or any instant — there is no day-boundary logic in this
 * function at all, so a UTC-rollover or an east-of-UTC timezone cannot
 * shift what gets stored (verified by this file's own rollover tests).
 */
export async function addClassAssessmentCore(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  name: string,
  type: AssessmentType,
  date: string
): Promise<AddClassAssessmentResult> {
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      domain: "school",
      title: name,
      due_date: date,
      // Identity by construction since migration 151 -- AssessmentType is
      // spelled identically to its corresponding tasks.task_type values, so
      // no translation map is needed (or should be reintroduced) here.
      task_type: type,
      class_id: classId,
    })
    .select("id")
    .single();
  if (taskError) throw taskError;

  const { data: assessment, error: assessmentError } = await supabase
    .from("class_assessments")
    .insert({
      user_id: userId,
      class_id: classId,
      name,
      type,
      date,
      task_id: task.id,
    })
    .select("id")
    .single();
  if (assessmentError) {
    // The task insert already committed (two separate statements, no
    // shared transaction on the write side — Postgres/PostgREST each
    // request is its own transaction). Clean up rather than leave an
    // orphaned task with no assessment behind it.
    await supabase.from("tasks").delete().eq("id", task.id).eq("user_id", userId);
    throw assessmentError;
  }

  return { assessmentId: assessment.id, taskId: task.id };
}

export interface UpdateClassAssessmentInput {
  name: string;
  type: AssessmentType;
  date: string;
  weightPct?: number | null;
  /** `class_assessments.category_id` (migration 152, Phase 1 #11) — which
   * `grade_categories` row this assessment belongs to, or null to
   * un-categorize it. Undefined (field omitted) leaves the column untouched,
   * same convention as `weightPct` above. */
  categoryId?: string | null;
  /**
   * GAP-01: the ONLY user-facing writer of `points_earned`/`points_possible`
   * this codebase has (Canvas grade sync, lib/canvas/sync-core.ts, is the
   * only OTHER one, and it never calls this function — it writes both
   * columns directly, scoped by its own never-overwrite check,
   * `canOverwriteGrade`). Providing EITHER field ALWAYS clears
   * `points_source` back to null (migration 189's own invariant: a
   * non-null points_earned with points_source=null is presumed
   * user-entered) — a user correcting a Canvas-synced grade here must not
   * have that correction silently re-overwritten by the next sync.
   * Treated as one unit because Canvas sync itself writes both together
   * under the same guard (sync-core.ts:265) — a hand-edit to `possible`
   * alone (e.g. fixing a wrong denominator) deserves the exact same
   * protection as editing `earned`. Undefined (omitted) leaves both
   * columns and points_source untouched, same convention as
   * weightPct/categoryId above.
   */
  pointsEarned?: number | null;
  pointsPossible?: number | null;
}

/**
 * The inverse of R5's create pairing, for edits: updates the assessment row
 * and, when it has a linked task (`task_id`), syncs that task's title/
 * due_date/task_type to match — otherwise editing an assessment's date here
 * would silently drift from the due date its own linked task still shows in
 * the main Task list. Same non-transactional two-statement shape as
 * `addClassAssessmentCore` (Postgres/PostgREST has no shared transaction
 * across these calls); a task-sync failure after the assessment row already
 * committed leaves the assessment as the source of truth and the task
 * stale, which is why the caller is expected to surface the error rather
 * than swallow it.
 */
export async function updateClassAssessmentCore(
  supabase: SupabaseClient,
  userId: string,
  assessmentId: string,
  fields: UpdateClassAssessmentInput
): Promise<void> {
  const { data: existing, error: fetchError } = await supabase
    .from("class_assessments")
    .select("task_id")
    .eq("id", assessmentId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase
    .from("class_assessments")
    .update({
      name: fields.name,
      type: fields.type,
      date: fields.date,
      // undefined (field omitted entirely) leaves the column untouched;
      // null is a real, storable "unknown weight" — never coalesced away.
      ...(fields.weightPct !== undefined ? { weight_pct: fields.weightPct } : {}),
      ...(fields.categoryId !== undefined ? { category_id: fields.categoryId } : {}),
      // GAP-01: a user-supplied grade always wins over -- and clears the
      // marker for -- whatever Canvas last synced. See this field's own
      // doc comment on UpdateClassAssessmentInput for why EITHER field
      // clears points_source, not just pointsEarned.
      ...(fields.pointsEarned !== undefined ? { points_earned: fields.pointsEarned } : {}),
      ...(fields.pointsPossible !== undefined ? { points_possible: fields.pointsPossible } : {}),
      ...(fields.pointsEarned !== undefined || fields.pointsPossible !== undefined ? { points_source: null } : {}),
    })
    .eq("id", assessmentId)
    .eq("user_id", userId);
  if (error) throw error;

  if (existing.task_id) {
    const { error: taskError } = await supabase
      .from("tasks")
      // Identity by construction since migration 151 -- see addClassAssessmentCore's
      // own comment on the same point.
      .update({ title: fields.name, due_date: fields.date, task_type: fields.type })
      .eq("id", existing.task_id)
      .eq("user_id", userId);
    if (taskError) throw taskError;
  }
}

// ---------------------------------------------------------------------
// Grade categories (migration 152, Phase 1 #11) -- CollegeOS's real weight-
// category model: drop_lowest_n / expected_item_count live on the category,
// never on an assessment (see that migration's own header). Schema shipped
// with zero UI wired to it -- this is that wiring.
// ---------------------------------------------------------------------

export interface GradeCategoryInput {
  name: string;
  weightPct: number;
  dropLowestN?: number;
  expectedItemCount?: number;
}

/** weight_pct > 0 and <= 100 is the table's own CHECK; not re-validated here --
 * a violation surfaces as a real Postgres error, same posture as weightPct on
 * class_assessments (that CHECK isn't re-implemented in actions-core.ts either). */
export async function createGradeCategoryCore(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  input: GradeCategoryInput
): Promise<string> {
  const { data, error } = await supabase
    .from("grade_categories")
    .insert({
      user_id: userId,
      class_id: classId,
      name: input.name,
      weight_pct: input.weightPct,
      drop_lowest_n: input.dropLowestN ?? 0,
      expected_item_count: input.expectedItemCount ?? 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateGradeCategoryCore(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  input: GradeCategoryInput
): Promise<void> {
  const { error } = await supabase
    .from("grade_categories")
    .update({
      name: input.name,
      weight_pct: input.weightPct,
      drop_lowest_n: input.dropLowestN ?? 0,
      expected_item_count: input.expectedItemCount ?? 1,
    })
    .eq("id", categoryId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** `class_assessments.category_id` is `ON DELETE SET NULL` scoped to that one
 * column (migration 152) -- deleting a category un-categorizes its
 * assessments rather than deleting them, so this needs no manual cleanup
 * pass the way `deleteClass` (class-actions.ts) does for its own FKs. */
export async function deleteGradeCategoryCore(supabase: SupabaseClient, userId: string, categoryId: string): Promise<void> {
  const { error } = await supabase.from("grade_categories").delete().eq("id", categoryId).eq("user_id", userId);
  if (error) throw error;
}
