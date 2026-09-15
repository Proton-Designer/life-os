"use server";

import { requireUser } from "@/lib/supabase/auth";
import { draftQuestionsFromNotes as draftQuestionsFromNotesCore, type QuestionDraftOutcome } from "@/lib/school/question-draft-generation";
import {
  draftQuestionsFromTranscript as draftQuestionsFromTranscriptCore,
  type TranscriptQuestionDraftOutcome,
} from "@/lib/school/question-draft-from-transcript";

export type { QuestionDraft, QuestionDraftOutcome } from "@/lib/school/question-draft-generation";
export type { TranscriptQuestionDraftOutcome } from "@/lib/school/question-draft-from-transcript";

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

/**
 * P3-16 — third input source for question drafting. Fetches the transcript
 * TEXT itself (scoped to the caller's own recording — `.eq("user_id",
 * userId)`, never trusts recordingId alone) rather than taking transcript
 * text as a parameter, so a caller can never pass in someone else's
 * transcript content by construction. Only a `completed` transcript has
 * `transcript_text` to draft from — `queued`/`processing`/`failed` all read
 * as "not ready yet," a normal state, not an error.
 */
export async function draftQuestionsFromTranscript(recordingId: string): Promise<TranscriptQuestionDraftOutcome | { status: "not_ready" }> {
  const { supabase, userId } = await requireUser();
  const { data: transcript, error } = await supabase
    .from("lecture_transcripts")
    .select("status, transcript_text")
    .eq("recording_id", recordingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!transcript || transcript.status !== "completed" || !transcript.transcript_text) {
    return { status: "not_ready" };
  }
  return draftQuestionsFromTranscriptCore(supabase, userId, transcript.transcript_text);
}
