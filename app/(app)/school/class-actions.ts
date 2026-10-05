"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import type { TaskListItem } from "@/components/school/task-list-module";
import type { TaskType } from "@/lib/tasks/task-type";
import {
  createClassCore,
  updateClassCore,
  addClassAssessmentCore,
  updateClassAssessmentCore,
  createGradeCategoryCore,
  updateGradeCategoryCore,
  deleteGradeCategoryCore,
  type AssessmentType,
  type GradeCategoryInput,
} from "@/lib/school/actions-core";
import { ASSESSMENT_VIEW_PATHS } from "@/lib/school/assessment-types";

export type { GradeCategoryInput };

export type { AssessmentType };

const SYLLABUS_BUCKET = "syllabi";
// Same bucket name as lecture-actions.ts's own (private, not exported) --
// duplicated rather than imported so this file doesn't need to claim
// lecture-actions.ts (same reasoning that file's own header gives for
// duplicating sanitizeFilenameSegment instead of importing it).
const LECTURES_BUCKET = "lectures";

/** SCHOOL-01: an assessment shows on /school, Home, /calendar and the evening close (through its paired task); revalidate all of them after any write. */
function revalidateAssessmentViews() {
  for (const path of ASSESSMENT_VIEW_PATHS) revalidatePath(path);
}
const SYLLABUS_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — short-lived, minted fresh per view, never cached.

/**
 * Ruling R5: adding an assessment also creates its task, using only the
 * assessment's own fields ("we have all the information we need") — no
 * separate task-description prompt. class_id ties both the class task
 * list and the main school list to this one row with no extra sync logic.
 */
export async function addClassAssessment(classId: string, name: string, type: AssessmentType, date: string) {
  const { supabase, userId } = await requireUser();
  await addClassAssessmentCore(supabase, userId, classId, name, type, date);
  revalidateAssessmentViews();
}

/**
 * The inverse of R5: one Postgres function call (migration 048's
 * delete_class_assessment) so the assessment delete and its task delete
 * either both happen or neither does — no client-side two-step that could
 * leave one without the other.
 */
export async function deleteClassAssessment(assessmentId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_class_assessment", { p_assessment_id: assessmentId });
  if (error) throw error;
  revalidateAssessmentViews();
}

/**
 * The inverse of R5's create pairing, for edits: updates the assessment row
 * and, when it has a linked task (`task_id`), syncs that task's title/
 * due_date/task_type to match — otherwise editing an assessment's date here
 * would silently drift from the due date its own linked task still shows in
 * the main Task list. Same non-transactional two-statement shape as
 * `addClassAssessment` (Postgres/PostgREST has no shared transaction across
 * these calls); a task-sync failure after the assessment row already
 * committed leaves the assessment as the source of truth and the task
 * stale, which is why the caller is expected to surface the error rather
 * than swallow it.
 */
export async function updateClassAssessment(
  assessmentId: string,
  fields: {
    name: string;
    type: AssessmentType;
    date: string;
    weightPct?: number | null;
    categoryId?: string | null;
    /** GAP-01: undefined leaves both columns + points_source untouched, same convention as weightPct/categoryId. See UpdateClassAssessmentInput's own doc for why either field clears points_source. */
    pointsEarned?: number | null;
    pointsPossible?: number | null;
  }
) {
  const { supabase, userId } = await requireUser();
  await updateClassAssessmentCore(supabase, userId, assessmentId, fields);
  revalidateAssessmentViews();
}

/** Phase 1 #11 — a real weight category (grade_categories, migration 152). */
export async function createGradeCategory(classId: string, input: GradeCategoryInput): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const id = await createGradeCategoryCore(supabase, userId, classId, input);
  revalidatePath("/school");
  return { id };
}

export async function updateGradeCategory(categoryId: string, input: GradeCategoryInput) {
  const { supabase, userId } = await requireUser();
  await updateGradeCategoryCore(supabase, userId, categoryId, input);
  revalidatePath("/school");
}

/** Un-categorizes any assessment filed under this category (ON DELETE SET
 * NULL, migration 152) rather than deleting them — see deleteGradeCategoryCore's
 * own comment. */
export async function deleteGradeCategory(categoryId: string) {
  const { supabase, userId } = await requireUser();
  await deleteGradeCategoryCore(supabase, userId, categoryId);
  revalidatePath("/school");
}

export async function listClassAssessments(classId: string) {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("class_assessments")
    .select("id, name, type, date, task_id")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * The class's own task list (item 6c) — the SAME `tasks` rows the main
 * School task list reads (TaskListModule, item 5), filtered to this
 * class_id. Not a second store: an assessment added here (R5) or a task
 * added through the main list against this class shows up in both places
 * because both read the identical rows, never because anything syncs them.
 * `className` isn't re-joined here — the caller already knows which class
 * it asked for and fills it in.
 */
export async function listClassTasks(classId: string): Promise<Omit<TaskListItem, "className">[]> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, due_date, task_type, task_type_other_label, class_id")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .eq("completed", false);
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    taskType: (t.task_type ?? "other") as TaskType,
    taskTypeOtherLabel: t.task_type_other_label,
    classId: t.class_id,
  }));
}

/**
 * Evening batch (2026-08-26), Ayman verbatim: an "Add" popup for the class
 * grid — short_name, code, room, instructor. `position` is computed here,
 * server-side, as max(existing)+1 for this user rather than left null:
 * null sorts last by code (fine as the fallback for a class that predates
 * `position` entirely, migration 052), but wrong for something he just
 * deliberately added — that has to land at the end of his intentional
 * order, not wherever `code` happens to alphabetize it.
 *
 * Same non-transactional select-then-insert shape already accepted
 * elsewhere in this file (e.g. addClassAssessment's task+assessment pair) —
 * a real race would require two adds landing in the same instant, which
 * this single-user app doesn't need to guard against.
 */
export async function createClass(fields: {
  shortName: string;
  code: string;
  room?: string;
  instructor?: string;
}): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const id = await createClassCore(supabase, userId, fields);
  revalidatePath("/school");
  return { id };
}

/** short_name (Opus Lead: must be editable, never seed-only), room, instructor, term,
 * late/attendance policy, allowed absences, grade boundaries (Phase 1 #11). */
export async function updateClass(
  classId: string,
  fields: {
    shortName?: string | null;
    code?: string;
    room?: string | null;
    instructor?: string | null;
    term?: string | null;
    latePolicy?: string | null;
    attendancePolicy?: string | null;
    allowedAbsences?: number | null;
    gradeBoundaries?: { letter: string; minPct: number }[] | null;
  }
) {
  const { supabase, userId } = await requireUser();
  // CANVAS-LITE-03: code is NOT NULL -- refuse an empty save here rather
  // than let a blank string reach the database (the same "the caller
  // enforces this, the core doesn't re-check" split allowedAbsences'
  // numeric-ness already uses).
  if (fields.code !== undefined && fields.code.trim() === "") {
    throw new Error("Class code can't be empty.");
  }
  await updateClassCore(supabase, userId, classId, fields);
  revalidatePath("/school");
}

function sanitizeFilenameSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Upload order is load-bearing (Opus Lead correction): upload the new
 * object FIRST, repoint `classes.syllabus_path` to it, and only THEN
 * delete the old object. A failure at any step leaves the previous
 * syllabus intact and still referenced — the worst case is an orphaned
 * object, never data loss. The path is timestamped, not a fixed name, so
 * the new upload can never collide with the old object while both briefly
 * coexist. Size and MIME type are enforced server-side by the bucket
 * itself (migration 048); this function doesn't re-implement that check.
 */
export async function uploadClassSyllabus(classId: string, formData: FormData) {
  const { supabase, userId } = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided");

  const { data: existing, error: fetchError } = await supabase
    .from("classes")
    .select("syllabus_path")
    .eq("id", classId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  const newPath = `${userId}/${classId}/${Date.now()}-${sanitizeFilenameSegment(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(SYLLABUS_BUCKET).upload(newPath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("classes")
    .update({ syllabus_path: newPath })
    .eq("id", classId)
    .eq("user_id", userId);
  if (updateError) {
    // The pointer never moved — clean up the just-uploaded orphan rather
    // than leave it consuming storage with nothing referencing it.
    await supabase.storage.from(SYLLABUS_BUCKET).remove([newPath]);
    throw updateError;
  }

  if (existing.syllabus_path) {
    // Best-effort: the swap has already fully succeeded from the user's
    // point of view (new file uploaded and pointed at) by this point, so a
    // failure here is an orphaned old object, not lost data.
    await supabase.storage.from(SYLLABUS_BUCKET).remove([existing.syllabus_path]);
  }

  revalidatePath("/school");
}

export async function removeClassSyllabus(classId: string) {
  const { supabase, userId } = await requireUser();
  const { data: existing, error: fetchError } = await supabase
    .from("classes")
    .select("syllabus_path")
    .eq("id", classId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;
  if (!existing.syllabus_path) return;

  const { error: updateError } = await supabase
    .from("classes")
    .update({ syllabus_path: null })
    .eq("id", classId)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  await supabase.storage.from(SYLLABUS_BUCKET).remove([existing.syllabus_path]);
  revalidatePath("/school");
}

export type SyllabusFileKind = "pdf" | "docx" | "other";

/**
 * Extension lives on the server, next to the actual path — the client
 * switches on a closed union it can't get wrong rather than sniffing the
 * URL string itself. "other" covers legacy .doc (in the bucket's allowed
 * MIME list, migration 048) and anything else docx-preview can't render;
 * it must land on an honest "can't preview" fallback, never the iframe.
 */
function syllabusFileKind(path: string): SyllabusFileKind {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return "other";
}

/**
 * Mints a fresh, short-lived signed URL on every call — never stored,
 * never cached across requests, never embedded in a page's own RSC
 * payload ahead of actually being viewed. The bucket is private; this is
 * the only way to ever read a syllabus object.
 */
export async function getClassSyllabusUrl(
  classId: string
): Promise<{ url: string; kind: SyllabusFileKind } | null> {
  const { supabase, userId } = await requireUser();
  const { data: row, error } = await supabase
    .from("classes")
    .select("syllabus_path")
    .eq("id", classId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (!row.syllabus_path) return null;

  const { data, error: signError } = await supabase.storage
    .from(SYLLABUS_BUCKET)
    .createSignedUrl(row.syllabus_path, SYLLABUS_SIGNED_URL_TTL_SECONDS);
  if (signError) throw signError;
  return { url: data.signedUrl, kind: syllabusFileKind(row.syllabus_path) };
}

/**
 * Deletes a class and everything that belongs to it.
 *
 * THE GAP THIS CLOSES: there was no class delete at all. `createClass` and
 * `updateClass` existed; nothing removed one. The only class-shaped removal
 * in the app was `removeClassEvent` (actions.ts), whose own doc comment
 * claims it "removes every row belonging to the class" — it deletes
 * `schedule_events` rows and nothing else. So dropping a class emptied its
 * calendar and left the class, its assessments and all of its coursework
 * behind, visible in the task list with no way to reach them. Found on
 * 2026-09-10 against a real account: an AMS class deleted from the schedule
 * still held 29 tasks and 2 assessments.
 *
 * WHY APPLICATION-LEVEL AND NOT THE FKs. The constraints are already
 * inconsistent — class_assessments/questions/sources CASCADE, while
 * schedule_events and tasks SET NULL. Relying on them would leave the two
 * SET NULL tables as orphans: a nulled schedule_event is a class meeting
 * that still renders on the schedule attached to no class, which is the
 * same "present but unreachable" defect in a new place. Fixing that in the
 * FKs means a migration against a shared schema another team is actively
 * changing; doing it here is smaller, needs no migration, and is one hunk
 * to revert.
 *
 * DELETE ORDER IS LOAD-BEARING. Dependents first, the class row last.
 * PostgREST gives these calls no shared transaction, so a failure partway
 * has to leave a retryable state: with the class row still present the user
 * can simply delete again. Reversed, a mid-failure would cascade the
 * assessments and null out the tasks/events, stranding rows with nothing
 * left to find them by. Storage is touched only after the database is
 * settled — the worst case there is an orphaned object, never lost data
 * (same reasoning as `removeClassSyllabus`).
 *
 * Tasks are DELETED, not unlinked, matching the app's own precedent:
 * `delete_class_assessment` (migration 048) removes an assessment together
 * with its linked task rather than leaving it dangling.
 */
export async function deleteClass(classId: string) {
  const { supabase, userId } = await requireUser();

  const { data: existing, error: fetchError } = await supabase
    .from("classes")
    .select("syllabus_path")
    .eq("id", classId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw fetchError;

  // CANVAS-LITE-03: stamp dismissed_at BEFORE the class itself is gone --
  // the FK's own ON DELETE SET NULL (migration 210) nulls class_id the
  // moment the class row disappears, which would lose which mapping row
  // to mark. "Removal sticks": a class that only existed because
  // auto-import created it must not reappear on the next connect/sync.
  // A no-op update (0 rows) when this class was never Canvas-linked.
  const { error: mappingDismissError } = await supabase
    .from("canvas_course_mappings")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("class_id", classId);
  if (mappingDismissError) throw mappingDismissError;

  const { error: eventsError } = await supabase
    .from("schedule_events")
    .delete()
    .eq("user_id", userId)
    .eq("class_id", classId);
  if (eventsError) throw eventsError;

  const { error: tasksError } = await supabase
    .from("tasks")
    .delete()
    .eq("user_id", userId)
    .eq("class_id", classId);
  if (tasksError) throw tasksError;

  // class_assessments (and questions/sources, for a domains-mode account)
  // go with the class row itself — those FKs already cascade correctly.
  const { error: classError } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId)
    .eq("user_id", userId);
  if (classError) throw classError;

  if (existing.syllabus_path) {
    await supabase.storage.from(SYLLABUS_BUCKET).remove([existing.syllabus_path]);
  }

  // P3-14 FIX (HANDOFF-team-b.md §5 item 1): lecture_recordings rows cascade
  // with the class delete above (FK), but the audio bytes themselves live in
  // the `lectures` bucket under `<userId>/<classId>/<filename>`
  // (lecture-actions.ts's own path convention) and were never removed --
  // orphaned forever. Best-effort, same posture as the syllabus cleanup just
  // above: the database is already settled by this point, so a storage
  // failure here must never surface as a failed delete.
  //
  // WRAPPED IN TRY/CATCH (2026-09-15 hardening, HEAD-red fix): the
  // "best-effort" claim only held for a returned `{data, error}` shape --
  // supabase-js storage calls don't throw under normal operation, but a
  // genuine best-effort guarantee must hold even if a call DOES throw (a
  // real network fault, or a test/mock client that throws instead of
  // resolving with an error). Caught and logged, never rethrown -- the class
  // row is already gone by this point, so surfacing this as a failed delete
  // would be dishonest.
  try {
    const { data: lectureFiles } = await supabase.storage.from(LECTURES_BUCKET).list(`${userId}/${classId}`);
    if (lectureFiles && lectureFiles.length > 0) {
      await supabase.storage.from(LECTURES_BUCKET).remove(lectureFiles.map((f) => `${userId}/${classId}/${f.name}`));
    }
  } catch (err) {
    console.error("[deleteClass] failed to clean up lecture storage objects", err);
  }

  revalidatePath("/school");
}
