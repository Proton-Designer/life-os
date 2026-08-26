"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import type { TaskListItem } from "@/components/school/task-list-module";
import type { TaskType } from "@/lib/tasks/task-type";

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

const SYLLABUS_BUCKET = "syllabi";
const SYLLABUS_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — short-lived, minted fresh per view, never cached.

/**
 * Ruling R5: adding an assessment also creates its task, using only the
 * assessment's own fields ("we have all the information we need") — no
 * separate task-description prompt. class_id ties both the class task
 * list and the main school list to this one row with no extra sync logic.
 */
export async function addClassAssessment(classId: string, name: string, type: AssessmentType, date: string) {
  const { supabase, userId } = await requireUser();

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

  const { error: assessmentError } = await supabase.from("class_assessments").insert({
    user_id: userId,
    class_id: classId,
    name,
    type,
    date,
    task_id: task.id,
  });
  if (assessmentError) {
    // The task insert already committed (two separate statements, no
    // shared transaction on the write side — Postgres/PostgREST each
    // request is its own transaction). Clean up rather than leave an
    // orphaned task with no assessment behind it.
    await supabase.from("tasks").delete().eq("id", task.id).eq("user_id", userId);
    throw assessmentError;
  }

  revalidatePath("/school");
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

/** short_name (Opus Lead: must be editable, never seed-only), room, instructor. */
export async function updateClass(
  classId: string,
  fields: { shortName?: string | null; room?: string | null; instructor?: string | null }
) {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("classes")
    .update({ short_name: fields.shortName, room: fields.room, instructor: fields.instructor })
    .eq("id", classId)
    .eq("user_id", userId);
  if (error) throw error;
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
