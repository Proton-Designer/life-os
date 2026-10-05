"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { addClassAssessmentCore, updateClassAssessmentCore } from "@/lib/school/actions-core";
import { ASSESSMENT_VIEW_PATHS, isAssessmentType, normalizeAssessmentType, type AssessmentType } from "@/lib/school/assessment-types";
import { getAssessmentsOverview, type AssessmentsOverview } from "@/lib/school/assessments-overview";
import { localDateString } from "@/lib/date-utils";
import { getProfile } from "@/lib/supabase/auth";

/**
 * SCHOOL-01: the Assessments module's actions. They are thin wrappers over the SAME cores the class dialog, the
 * syllabus-confirm path and MCP use (addClassAssessmentCore / updateClassAssessmentCore / the delete_class_assessment
 * RPC), so one write updates the assessment AND its paired task, and every page that shows either is revalidated
 * from ONE list (ASSESSMENT_VIEW_PATHS: /school, /, /calendar, /close). Values are absolute (never toggles).
 *
 * Remove = a HARD delete of the assessment together with its paired task, atomically (migration 048's
 * delete_class_assessment): the same semantics the class dialog already had. There is no archive state.
 */

export type AssessmentActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 120;

function validate(name: string, type: string, date: string): { ok: true; name: string; type: AssessmentType; date: string } | { ok: false; message: string } {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return { ok: false, message: "Give the assessment a name." };
  if (trimmed.length > MAX_NAME) return { ok: false, message: `Keep the name under ${MAX_NAME} characters.` };
  if (!isAssessmentType(type)) return { ok: false, message: "Pick a valid assessment type." };
  if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) return { ok: false, message: "Pick a valid date." };
  return { ok: true, name: trimmed, type: normalizeAssessmentType(type), date };
}

function revalidateAssessmentViews(): void {
  for (const path of ASSESSMENT_VIEW_PATHS) revalidatePath(path);
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : ((err as { message?: string } | null)?.message ?? fallback);
}

/** The module's data: all upcoming assessments grouped Soon / Upcoming / Future, plus items still missing a date. */
export async function getMyAssessmentsOverview(): Promise<AssessmentsOverview> {
  const { supabase, userId } = await requireUser();
  const timezone = (await getProfile())?.timezone ?? "UTC";
  return getAssessmentsOverview(supabase, userId, localDateString(new Date(), timezone));
}

export async function addAssessment(classId: string, input: { name: string; type: AssessmentType; date: string }): Promise<AssessmentActionResult<{ assessmentId: string; taskId: string }>> {
  const v = validate(input.name, input.type, input.date);
  if (!v.ok) return v;
  const { supabase, userId } = await requireUser();
  const { data: cls, error: classError } = await supabase.from("classes").select("id").eq("id", classId).eq("user_id", userId).maybeSingle();
  if (classError || !cls) return { ok: false, message: "That class wasn't found." };
  try {
    const { assessmentId, taskId } = await addClassAssessmentCore(supabase, userId, classId, v.name, v.type, v.date);
    revalidateAssessmentViews();
    return { ok: true, assessmentId, taskId };
  } catch (err) {
    return { ok: false, message: messageOf(err, "Couldn't add that assessment.") };
  }
}

/** Absolute values for name/type/date (and the paired task follows). Other fields (weight, grade, category) are left alone. */
export async function updateAssessment(assessmentId: string, input: { name: string; type: AssessmentType; date: string }): Promise<AssessmentActionResult> {
  const v = validate(input.name, input.type, input.date);
  if (!v.ok) return v;
  const { supabase, userId } = await requireUser();
  try {
    await updateClassAssessmentCore(supabase, userId, assessmentId, { name: v.name, type: v.type, date: v.date });
    revalidateAssessmentViews();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: messageOf(err, "Couldn't save that assessment.") };
  }
}

export async function removeAssessment(assessmentId: string): Promise<AssessmentActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_class_assessment", { p_assessment_id: assessmentId });
  if (error) return { ok: false, message: error.message?.includes("not found") ? "That assessment was already removed." : "Couldn't remove that assessment." };
  revalidateAssessmentViews();
  return { ok: true };
}
