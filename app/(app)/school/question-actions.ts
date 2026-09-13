"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  createQuestionCore,
  updateQuestionCore,
  setQuestionActiveCore,
  type CreateQuestionInput,
  type UpdateQuestionInput,
  type QuestionOrigin,
} from "@/lib/school/questions-core";

export type { CreateQuestionInput, UpdateQuestionInput, QuestionOrigin };

/**
 * Phase 1 #20/#22 — cookie-coupled Server Action layer over
 * lib/school/questions-core.ts, same split as class-actions.ts over
 * actions-core.ts: requireUser() lives here, the actual writes there,
 * unit-testable independent of Next's request context.
 */
export async function createQuestion(input: CreateQuestionInput) {
  const { supabase, userId } = await requireUser();
  const result = await createQuestionCore(supabase, userId, input);
  revalidatePath("/school");
  return result;
}

export async function updateQuestion(questionId: string, input: UpdateQuestionInput) {
  const { supabase, userId } = await requireUser();
  await updateQuestionCore(supabase, userId, questionId, input);
  revalidatePath("/school");
}

/**
 * Retire (active: false) or reactivate (active: true) — never a hard
 * delete. See lib/school/questions-core.ts's own header for why.
 */
export async function setQuestionActive(questionId: string, active: boolean) {
  const { supabase, userId } = await requireUser();
  await setQuestionActiveCore(supabase, userId, questionId, active);
  revalidatePath("/school");
}
