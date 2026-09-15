"use server";

import { requireUser } from "@/lib/supabase/auth";
import { evaluateTeachBack } from "@/lib/self-mastery/teach-back";

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
  | { outcome: "too_short" }
  | { outcome: "no_key" }
  | { outcome: "unavailable" }
  | { outcome: "parse_failed" };

const MIN_EXPLANATION_LENGTH = 20;

export async function submitTeachBack(lessonId: string, explanation: string): Promise<SubmitTeachBackResult> {
  const trimmed = explanation.trim();
  if (trimmed.length < MIN_EXPLANATION_LENGTH) {
    return { outcome: "too_short" };
  }

  const { supabase, userId } = await requireUser();
  const result = await evaluateTeachBack(supabase, userId, lessonId, trimmed);
  if (result.status !== "evaluated") {
    return { outcome: result.status };
  }
  return { outcome: "evaluated", followUpQuestions: result.followUpQuestions, gapFeedback: result.gapFeedback };
}
