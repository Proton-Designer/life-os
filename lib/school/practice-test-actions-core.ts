import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P4-08: thin extraction of `submitPracticeTestAnswer`/`completePracticeTest`'s
 * actual logic out of `app/(app)/school/practice-test-actions.ts` (a "use
 * server" file, whose functions resolve `supabase`/`userId` internally via
 * `requireUser()`) into plain `(supabase, userId, ...)` cores an MCP write
 * handler can also call -- same R5 pattern as `lib/school/actions-core.ts`/
 * `questions-core.ts`/`staging-core.ts`. The Server Action wrappers now call
 * these directly; behavior is UNCHANGED, this is extraction only.
 */

/**
 * Upsert (not a plain insert) -- the unique (user_id, practice_test_id,
 * question_id) constraint means re-answering the same question in one
 * sitting updates the existing row rather than erroring, so a caller can
 * freely change their self-report before completing the test. Both FKs
 * (practice_test_id, question_id) are composite-scoped to (user_id, id) --
 * a foreign or nonexistent id raises a real FK violation (23503), which the
 * MCP handler translates to ToolNotFoundError; the Server Action leaves it
 * as a plain thrown error, matching its pre-P4-08 behavior.
 */
export async function submitPracticeTestAnswerCore(
  supabase: SupabaseClient,
  userId: string,
  practiceTestId: string,
  questionId: string,
  selfReportedCorrect: boolean,
): Promise<void> {
  const { error } = await supabase.from("practice_test_answers").upsert(
    {
      user_id: userId,
      practice_test_id: practiceTestId,
      question_id: questionId,
      self_reported_correct: selfReportedCorrect,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "user_id,practice_test_id,question_id" },
  );
  if (error) throw error;
}

export interface CompletePracticeTestResult {
  scorePct: number;
  answeredCount: number;
  questionCount: number;
}

/**
 * Marks a practice test completed and computes+stores score_pct from the
 * recorded self-reports. An unanswered question (skipped, or the test was
 * closed early) counts as NOT correct in the score -- never silently
 * excluded from the denominator, which would inflate the score for a
 * partially-attempted test. `.single()` on the initial read throws (not a
 * friendly not-found) when `practiceTestId` doesn't belong to this user --
 * unchanged from the pre-extraction Server Action's own behavior; the MCP
 * handler does its own existence check before calling this, same
 * SELECT-first-then-ToolNotFoundError convention every other write-registry
 * entity in this file already uses.
 */
export async function completePracticeTestCore(supabase: SupabaseClient, userId: string, practiceTestId: string): Promise<CompletePracticeTestResult> {
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

  return { scorePct, answeredCount: answers?.length ?? 0, questionCount };
}
