"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";

/**
 * P2-09 — the action-layer surface for taking an already-assembled
 * practice test (assembly itself happens server-side via the cron
 * dispatcher, lib/school/practice-test.ts's `dispatchPracticeTestAssembly`
 * — nothing here creates a practice_tests row). Answering is reveal-then-
 * self-report, the same shape the FSRS retrieval session already uses —
 * see practice-test.ts's own header for why this app doesn't do automated
 * free-text grading.
 */

export interface PracticeTestListItem {
  id: string;
  assessmentId: string;
  intervalLabel: string;
  questionIds: string[];
  status: string;
  scorePct: number | null;
  createdAt: string;
  completedAt: string | null;
}

/** Every practice test for one class, most recent first. */
export async function getMyPracticeTests(classId: string): Promise<PracticeTestListItem[]> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("practice_tests")
    .select("id, assessment_id, interval_label, question_ids, status, score_pct, created_at, completed_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    assessmentId: row.assessment_id,
    intervalLabel: row.interval_label,
    questionIds: row.question_ids,
    status: row.status,
    scorePct: row.score_pct === null ? null : Number(row.score_pct),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

/**
 * Records one self-reported answer. Upsert (not a plain insert) — the
 * unique (user_id, practice_test_id, question_id) constraint means
 * re-answering the same question in one sitting updates the existing row
 * rather than erroring, so a user can freely change their self-report
 * before completing the test.
 */
export async function submitPracticeTestAnswer(practiceTestId: string, questionId: string, selfReportedCorrect: boolean): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("practice_test_answers").upsert(
    {
      user_id: userId,
      practice_test_id: practiceTestId,
      question_id: questionId,
      self_reported_correct: selfReportedCorrect,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "user_id,practice_test_id,question_id" }
  );
  if (error) throw error;
}

export interface PracticeTestQuestion {
  id: string;
  prompt: string;
  answer: string;
}

/** The actual question text/answer for one practice test's assembled set, in the SAME order the test was assembled (question_ids' own order), not the order the `questions` table happens to return them. */
export async function getPracticeTestQuestions(practiceTestId: string): Promise<PracticeTestQuestion[]> {
  const { supabase, userId } = await requireUser();

  const { data: test, error: testError } = await supabase
    .from("practice_tests")
    .select("question_ids")
    .eq("id", practiceTestId)
    .eq("user_id", userId)
    .single();
  if (testError) throw testError;
  if (test.question_ids.length === 0) return [];

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id, prompt, answer")
    .eq("user_id", userId)
    .in("id", test.question_ids);
  if (questionsError) throw questionsError;

  const byId = new Map((questions ?? []).map((q) => [q.id, q]));
  return test.question_ids.map((id: string) => byId.get(id)).filter((q): q is PracticeTestQuestion => q !== undefined);
}

export interface CompletePracticeTestResult {
  scorePct: number;
  answeredCount: number;
  questionCount: number;
}

/**
 * Marks a practice test completed and computes+stores score_pct from the
 * recorded self-reports. An unanswered question (the user skipped it, or
 * closed the test early) counts as NOT correct in the score — never
 * silently excluded from the denominator, which would inflate the score
 * for a partially-attempted test.
 */
export async function completePracticeTest(practiceTestId: string): Promise<CompletePracticeTestResult> {
  const { supabase, userId } = await requireUser();

  const { data: test, error: testError } = await supabase
    .from("practice_tests")
    .select("question_ids")
    .eq("id", practiceTestId)
    .eq("user_id", userId)
    .single();
  if (testError) throw testError;

  const { data: answers, error: answersError } = await supabase
    .from("practice_test_answers")
    .select("question_id, self_reported_correct")
    .eq("practice_test_id", practiceTestId)
    .eq("user_id", userId);
  if (answersError) throw answersError;

  const questionCount = test.question_ids.length;
  const correctByQuestion = new Map((answers ?? []).map((a) => [a.question_id, a.self_reported_correct]));
  const correctCount = test.question_ids.filter((id: string) => correctByQuestion.get(id) === true).length;
  const scorePct = questionCount > 0 ? Math.round((correctCount / questionCount) * 10000) / 100 : 0;

  const { error: updateError } = await supabase
    .from("practice_tests")
    .update({ status: "completed", score_pct: scorePct, completed_at: new Date().toISOString() })
    .eq("id", practiceTestId)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  revalidatePath("/school");
  return { scorePct, answeredCount: answers?.length ?? 0, questionCount };
}
