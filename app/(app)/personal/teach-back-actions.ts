"use server";

import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { evaluateTeachBack, fetchTeachableLesson } from "@/lib/self-mastery/teach-back";
import { routeAiRequest } from "@/lib/agent-jobs/route";
import { enqueueAgentJobCore } from "@/lib/agent-jobs/core";
import { getFeedbackState, markFeedbackNotesSeen, type FeedbackState } from "@/lib/self-mastery/feedback-notes";
import { recordTeachBackUsage } from "@/lib/self-mastery/session/build-session";

/** P2-18 — the action-layer wiring for Teach-Back mode's entry (lesson picker) and evaluation. */

export interface TeachableLesson {
  id: string;
  title: string;
  coreClaim: string | null;
}

/** Lessons real enough to teach back on -- `status = 'active'`, this user's own book. */
export async function getTeachableLessons(bookId: string): Promise<TeachableLesson[]> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("lessons")
    .select("id, title, core_claim")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("rank", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, title: row.title, coreClaim: row.core_claim }));
}

export type SubmitTeachBackResult =
  | { outcome: "evaluated"; followUpQuestions: string[]; gapFeedback: string }
  /** No AI key but a connected agent: the explanation is saved and the agent's feedback attaches to the lesson when it arrives ("feedback later"). */
  | { outcome: "queued" }
  | { outcome: "too_short" }
  | { outcome: "no_key" }
  | { outcome: "unavailable" }
  | { outcome: "parse_failed" };

const MIN_EXPLANATION_LENGTH = 20;
/** Same cap as the in-app evaluation (teach-back.ts MAX_EXPLANATION_CHARS). */
const TEACH_BACK_QUEUE_MAX_CHARS = 4_000;

export async function submitTeachBack(lessonId: string, explanation: string): Promise<SubmitTeachBackResult> {
  const trimmed = explanation.trim();
  if (trimmed.length < MIN_EXPLANATION_LENGTH) {
    return { outcome: "too_short" };
  }

  const { supabase, userId } = await requireUser();

  if ((await routeAiRequest(supabase, userId, new Date())) === "queue") {
    try {
      const lesson = await fetchTeachableLesson(supabase, userId, lessonId);
      if (!lesson) return { outcome: "parse_failed" }; // no real lesson to grade against, same as the in-app path
      await enqueueAgentJobCore(supabase, { kind: "self_mastery.teach_back_grade", subjectId: lessonId, input: { lesson, explanation: trimmed.slice(0, TEACH_BACK_QUEUE_MAX_CHARS) } });
      return { outcome: "queued" };
    } catch {
      return { outcome: "unavailable" };
    }
  }

  const result = await evaluateTeachBack(supabase, userId, lessonId, trimmed);
  if (result.status !== "evaluated") {
    return { outcome: result.status };
  }

  // P3-03: "recite" is only recorded on a genuine evaluated outcome (a real
  // explanation AND real gap feedback -- study-methods.ts's own
  // description) -- see recordTeachBackUsage's own header for why this
  // needs its own bridge rather than reusing submitSelfExplanation's
  // sessionId-based pattern directly.
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  await recordTeachBackUsage(supabase, localDateString(new Date(), timezone));

  return { outcome: "evaluated", followUpQuestions: result.followUpQuestions, gapFeedback: result.gapFeedback };
}

/** Feedback an agent attached to earlier explanations of this lesson, and whether one is still on its way. Display-only. */
export async function getLessonFeedbackState(lessonId: string): Promise<FeedbackState> {
  const { supabase, userId } = await requireUser();
  return getFeedbackState(supabase, userId, { subjectType: "lesson", subjectId: lessonId });
}

/** The notes were shown: stop highlighting them as new. */
export async function markLessonFeedbackSeen(noteIds: string[]): Promise<void> {
  const { supabase } = await requireUser();
  await markFeedbackNotesSeen(supabase, noteIds.slice(0, 10));
}
