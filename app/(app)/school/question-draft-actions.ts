"use server";

import { requireUser } from "@/lib/supabase/auth";
import { draftQuestionsFromNotes as draftQuestionsFromNotesCore, type QuestionDraftOutcome } from "@/lib/school/question-draft-generation";

export type { QuestionDraft, QuestionDraftOutcome } from "@/lib/school/question-draft-generation";

/**
 * Phase 1 #23 — cookie-coupled Server Action layer over
 * lib/school/question-draft-generation.ts, same split as question-actions.ts
 * over questions-core.ts: requireUser() lives here, the actual gateway call
 * there, unit-testable independent of Next's request context.
 *
 * Deliberately NOT class-scoped: drafting is pure text-in/drafts-out, no DB
 * write happens here at all — a draft only becomes a real row when the
 * user adds it via the existing `createQuestion` action, which is where
 * `classId` (and everything else `questions` needs) is supplied.
 */
export async function draftQuestionsFromNotes(notesText: string): Promise<QuestionDraftOutcome> {
  const { supabase, userId } = await requireUser();
  return draftQuestionsFromNotesCore(supabase, userId, notesText);
}
