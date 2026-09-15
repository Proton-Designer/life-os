import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";

/**
 * P2-09: practice tests auto-assembled from a class's active question bank
 * at fixed pre-exam intervals. See migration 185's own header for the table
 * shapes and lock mechanism.
 *
 * "EXAM CURVE" -- the acceptance criteria's own phrase, and the ONLY
 * source for it (phase-2-build-plan.md line 40: "Assembly logic on top of
 * Phase 1's question bank + exam curve") -- read as the escalating-
 * frequency SHAPE of `PRACTICE_TEST_INTERVALS` itself (T-14/T-7/T-3/T-1,
 * named explicitly in the acceptance criteria), not a reference to a
 * separate mechanism: none exists anywhere in this repo under that name.
 *
 * ANSWER CHECKING: reveal-then-self-report, the SAME shape the FSRS
 * retrieval session already uses (components/self-mastery/session/
 * retrieval-session-overlay.tsx) -- this app has no automated free-text
 * grading anywhere, and `questions.answer` is free text with no structured
 * grading key, so a second, worse grading mechanism for the identical data
 * shape isn't built here either.
 */

export interface PracticeTestInterval {
  label: "T-14" | "T-7" | "T-3" | "T-1";
  daysBefore: number;
}

/** Fixed and ordered furthest-to-nearest -- matches migration 185's own CHECK constraint exactly (the DB is the actual enforcement; this is the app's own copy of the same fixed schedule). */
export const PRACTICE_TEST_INTERVALS: readonly PracticeTestInterval[] = [
  { label: "T-14", daysBefore: 14 },
  { label: "T-7", daysBefore: 7 },
  { label: "T-3", daysBefore: 3 },
  { label: "T-1", daysBefore: 1 },
];

export const MAX_QUESTIONS_PER_PRACTICE_TEST = 10;

/** Pure calendar-day difference between two YYYY-MM-DD strings (toStr - fromStr), UTC-midnight arithmetic on the date components themselves -- same technique lib/date-utils.ts's own addDaysToDateString/dayOfWeekFromDateString use, never a timezone-sensitive instant diff. */
export function daysBetweenDateStrings(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const fromUtc = Date.UTC(fy!, fm! - 1, fd!);
  const toUtc = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** Deterministic, seeded shuffle (mulberry32-style) -- NOT `Math.random()`: the same (assessment, interval) seed always produces the same order, so tests are reproducible and a re-run of the dispatcher (which never happens post-assembly, thanks to the unique-constraint lock, but might in a test) is stable. Different seeds (different intervals) give different orders over the same bank, so T-14/T-7/T-3/T-1 don't all show the identical first N questions. */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  function next(): number {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  }
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Picks up to `count` question ids from the class's active bank, seeded so different intervals for the same exam draw different (reproducible) subsets. Pure -- no clock, no Supabase (the caller fetches the active id list; this file's dispatcher below is what wires it to a real query). */
export function assemblePracticeTestQuestions(activeQuestionIds: readonly string[], seed: string, count: number = MAX_QUESTIONS_PER_PRACTICE_TEST): string[] {
  return seededShuffle(activeQuestionIds, seed).slice(0, count);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export class PracticeTestClassMismatchError extends Error {
  constructor(assessmentId: string, expectedClassId: string, actualClassId: string) {
    super(
      `Practice test assembly: assessment ${assessmentId} belongs to class ${expectedClassId}, but class ${actualClassId} was about to be written -- refusing to create a practice_tests row pointing at the wrong class.`
    );
    this.name = "PracticeTestClassMismatchError";
  }
}

/**
 * Explicit invariant enforcement (Opus Lead finding, 2026-09-15): nothing
 * in migration 185's schema ties `practice_tests.class_id` to
 * `class_assessments.class_id` for a given `assessment_id` -- a composite
 * FK on `(user_id, assessment_id, class_id)` isn't expressible against
 * `class_assessments` without a matching unique index carrying all three,
 * which would duplicate `class_assessments_user_id_id_key` (167) for no
 * other purpose. The app layer is therefore the only guard, and this is
 * that guard as an explicit, named, testable step rather than an implicit
 * assumption a future refactor (a manual re-assembly trigger, a caller
 * that supplies `classId` independently of `assessmentId`) could silently
 * break. Every writer of a `practice_tests` row MUST call this
 * immediately before the insert, passing the class_id it read from the
 * SAME `class_assessments` row the assessment_id came from -- never a
 * caller-supplied or cached value from anywhere else.
 */
export function assertPracticeTestClassMatchesAssessment(assessmentId: string, assessmentClassId: string, classIdToWrite: string): void {
  if (assessmentClassId !== classIdToWrite) {
    throw new PracticeTestClassMismatchError(assessmentId, assessmentClassId, classIdToWrite);
  }
}

interface ExamRow {
  id: string;
  user_id: string;
  class_id: string;
  date: string;
}

export interface PracticeTestDispatchResult {
  /** Distinct upcoming exam/final_midterm class_assessments rows this tick considered, across all users. */
  examsChecked: number;
  assembled: number;
}

/**
 * The per-exam loop. For every exam/final_midterm `class_assessments` row,
 * checks whether TODAY (in that row's OWNER's own timezone -- never the
 * server's UTC day) is exactly one of the fixed days-before marks; if so,
 * assembles a practice test from that class's active question bank.
 *
 * THE LOCK is migration 185's own `unique (user_id, assessment_id,
 * interval_label)` -- the INSERT itself is the claim, no separate claim
 * table needed (unlike due-card/morning-brief/sleep-reminder's own claim-
 * then-fill shape): this row IS the assembled content, so there's nothing
 * to fill in after claiming. A 23505 means another tick (or, in practice,
 * this same tick re-running after a partial failure) already assembled
 * this exact (exam, interval) -- skip, not an error.
 *
 * A class with an empty active question bank produces NO practice test
 * for that interval (there's nothing to assemble) -- not an error, and
 * not a permanently-skipped interval either: if a question gets added
 * before the NEXT interval's own days-before mark, that one can still
 * assemble normally.
 */
export async function dispatchPracticeTestAssembly(supabase: SupabaseClient, now: Date): Promise<PracticeTestDispatchResult> {
  const { data: examRows, error: examError } = await supabase
    .from("class_assessments")
    .select("id, user_id, class_id, date")
    .in("type", ["exam", "final_midterm"]);
  if (examError) throw examError;
  const exams = (examRows ?? []) as ExamRow[];
  if (exams.length === 0) return { examsChecked: 0, assembled: 0 };

  const userIds = [...new Set(exams.map((e) => e.user_id))];
  const { data: profileRows, error: profileError } = await supabase.from("profiles").select("user_id, timezone").in("user_id", userIds);
  if (profileError) throw profileError;
  const timezoneByUser = new Map((profileRows ?? []).map((p: { user_id: string; timezone: string | null }) => [p.user_id, p.timezone ?? "UTC"]));

  let assembled = 0;
  for (const exam of exams) {
    const timezone = timezoneByUser.get(exam.user_id) ?? "UTC";
    const todayStr = localDateString(now, timezone);
    const daysUntil = daysBetweenDateStrings(todayStr, exam.date);
    const interval = PRACTICE_TEST_INTERVALS.find((i) => i.daysBefore === daysUntil);
    if (!interval) continue;

    const { data: questionRows, error: questionError } = await supabase
      .from("questions")
      .select("id")
      .eq("user_id", exam.user_id)
      .eq("class_id", exam.class_id)
      .eq("active", true);
    if (questionError) throw questionError;
    const activeIds = (questionRows ?? []).map((q: { id: string }) => q.id);
    if (activeIds.length === 0) continue;

    const questionIds = assemblePracticeTestQuestions(activeIds, `${exam.id}:${interval.label}`);

    // THE ENFORCEMENT POINT (fixed 2026-09-15, Opus Lead review: the
    // original version passed exam.class_id for BOTH arguments, so the
    // check could never fail -- it was comparing a value to itself).
    // assessmentRow.class_id below is a fresh, independent read of the
    // assessment's own row, decoupled from the batch fetch above, so this
    // actually exercises the invariant rather than restating it.
    const { data: assessmentRow, error: assessmentError } = await supabase
      .from("class_assessments")
      .select("class_id")
      .eq("id", exam.id)
      .maybeSingle();
    if (assessmentError) throw assessmentError;
    if (!assessmentRow) continue; // assessment vanished between the batch fetch and here

    assertPracticeTestClassMatchesAssessment(exam.id, assessmentRow.class_id, exam.class_id);

    const { error: insertError } = await supabase.from("practice_tests").insert({
      user_id: exam.user_id,
      class_id: exam.class_id,
      assessment_id: exam.id,
      interval_label: interval.label,
      question_ids: questionIds,
    });
    if (insertError) {
      if (isUniqueViolation(insertError)) continue;
      throw insertError;
    }
    assembled++;
  }

  return { examsChecked: exams.length, assembled };
}
