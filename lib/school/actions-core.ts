import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export interface UpdateClassInput {
  shortName?: string | null;
  room?: string | null;
  instructor?: string | null;
}

/** short_name (Opus Lead: must be editable, never seed-only), room, instructor. */
export async function updateClassCore(supabase: SupabaseClient, userId: string, classId: string, input: UpdateClassInput): Promise<void> {
  const { error } = await supabase
    .from("classes")
    .update({ short_name: input.shortName, room: input.room, instructor: input.instructor })
    .eq("id", classId)
    .eq("user_id", userId);
  if (error) throw error;
}

export type AssessmentType = "quiz" | "exam" | "midterm_final";

// This module's own naming ("midterm_final", matching the item 6 spec's
// "Midterm/Final" assessment type) differs from tasks.task_type's
// "final_midterm" (B's 050, matching item 5's "Final/Midterm" task type) —
// same concept, independently named in two different check constraints
// added by two different engineers the same night. Mapped explicitly here
// rather than forced to share one literal string.
const ASSESSMENT_TYPE_TO_TASK_TYPE: Record<AssessmentType, string> = {
  quiz: "quiz",
  exam: "exam",
  midterm_final: "final_midterm",
};

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
      task_type: ASSESSMENT_TYPE_TO_TASK_TYPE[type],
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
    })
    .eq("id", assessmentId)
    .eq("user_id", userId);
  if (error) throw error;

  if (existing.task_id) {
    const { error: taskError } = await supabase
      .from("tasks")
      .update({ title: fields.name, due_date: fields.date, task_type: ASSESSMENT_TYPE_TO_TASK_TYPE[fields.type] })
      .eq("id", existing.task_id)
      .eq("user_id", userId);
    if (taskError) throw taskError;
  }
}
