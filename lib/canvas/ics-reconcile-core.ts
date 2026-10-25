import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCanvasIcsFeed, icsDateStrToLocalDateString } from "@/lib/canvas/ics-parser";
import { getMappedCourses, findUnambiguousLocalMatch, type LocalAssessment } from "@/lib/canvas/sync-core";
import { autoImportCanvasCoursesAsClassesCore, type AutoImportCoursesResult } from "@/lib/canvas/course-auto-import-core";
import { createStagingBatchCore, createStagedDeliverablesCore } from "@/lib/school/staging-core";
import type { ExtractedItem } from "@/lib/school/syllabus-extraction";

/**
 * P3-13 -- ICS calendar-feed reconciliation, the second (complementary,
 * not competing) Canvas assignment discovery path alongside P2-21's REST
 * grade-sync poll. The REST assignments endpoint only covers courses the
 * user has mapped and only assignment-typed items; a student's ICS
 * calendar feed is a flat export of everything on their Canvas calendar,
 * so it can surface assignments the REST sync missed.
 *
 * REUSES P2-21's rules verbatim, per the Lead's explicit instructions:
 *  - the dedup/tombstone marker: an assignment already linked
 *    (`class_assessments.canvas_assignment_id`) or already staged/rejected
 *    (`staging_batches.canvas_assignment_id`, migration 194's tombstone --
 *    survives a reject, since only the child `staged_deliverables` row is
 *    deleted) is skipped.
 *  - the unambiguous-match rule (`findUnambiguousLocalMatch`, extracted
 *    from `syncCanvasGradesCore` for exactly this reuse): a user-typed
 *    assessment the REST sync never encountered (so it's still
 *    `unlinked`) gets LINKED by whichever discovery path finds it first
 *    -- same class, exact normalized title, or a single due-date match --
 *    rather than offered as a rejectable staged duplicate. Unlike grade
 *    sync, there is no grade to write here (an ICS VEVENT carries no
 *    score), so a match only ever sets `canvas_assignment_id`.
 *  - never auto-creates an assessment: a genuinely unmatched find goes
 *    through the SAME staged-diff confirm pipeline (P2-07/P2-21), zero
 *    new confirm/reject UI needed.
 */

export interface IcsReconcileResult {
  parsedAssignmentEvents: number;
  alreadyCovered: number;
  linkedToExisting: number;
  unmapped: number;
  newlyStaged: number;
  /** A due date that moved in Canvas for an assessment the person already has: a CHANGE staged for them to confirm (never an overwrite). */
  rescheduleStaged: number;
  /** A date that moved for something still PENDING in staging: the staged date was updated in place. */
  stagedDateUpdated: number;
  /**
   * CANVAS-LITE-04: a course seen ONLY through the ICS feed (never
   * token-connected, never agent-imported) now goes through the SAME
   * shared `autoImportCanvasCoursesAsClassesCore` the token path uses --
   * this is the no-token student's own primary case (their school blocks
   * access tokens entirely), so `unmapped` above should trend toward zero
   * over time instead of silently accumulating. The feed carries no
   * course name at all (only a numeric id parsed from each assignment's
   * URL, per ics-parser.ts's own documented-shape-only posture) or a
   * computed grade, so an auto-created class here gets an honest
   * placeholder name (`Canvas course <id>`) -- editable afterwards,
   * same as any other class (CANVAS-LITE-03's own code-editability change).
   */
  courseImport: AutoImportCoursesResult;
}

interface ParsedAssignmentEvent {
  canvasCourseId: string;
  canvasAssignmentId: string;
  summary: string | null;
  dateStr: string | null;
}

/**
 * CANVAS-LITE-04 (Lead follow-up, live UX concern): Canvas's own per-user
 * ICS feed commonly suffixes each assignment's SUMMARY with the course in
 * square brackets (e.g. "Homework 3 [CS 3345.001]") -- a real, commonly-
 * observed Canvas convention, though (like UID, per ics-parser.ts's own
 * header) not part of the documented shape the assignment URL's
 * `/courses/<id>/` path is. Used ONLY as a nicer label when present;
 * never trusted as an id, and the numeric-id placeholder remains the
 * honest fallback when no bracket suffix appears at all. Either way the
 * resulting class name/code is editable afterwards (CANVAS-LITE-03's own
 * code-editability change) — this only changes the DEFAULT, never a
 * dead end.
 */
function extractCourseLabelFromSummary(summary: string | null): string | null {
  if (!summary) return null;
  const match = summary.match(/\[([^[\]]+)\]\s*$/);
  return match ? match[1]!.trim() || null : null;
}

export async function reconcileCanvasIcsCore(supabase: SupabaseClient, userId: string, timezone: string, icsText: string): Promise<IcsReconcileResult> {
  const parsedEvents: ParsedAssignmentEvent[] = parseCanvasIcsFeed(icsText)
    .filter((e) => e.canvasAssignmentId !== null && e.canvasCourseId !== null)
    .map((e) => ({
      canvasCourseId: e.canvasCourseId as string,
      canvasAssignmentId: e.canvasAssignmentId as string,
      summary: e.summary,
      dateStr: e.dtstart ? icsDateStrToLocalDateString(e.dtstart, timezone) : null,
    }));

  const EMPTY_COURSE_IMPORT: AutoImportCoursesResult = { created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 };
  const result: IcsReconcileResult = {
    parsedAssignmentEvents: parsedEvents.length,
    alreadyCovered: 0,
    linkedToExisting: 0,
    unmapped: 0,
    newlyStaged: 0,
    rescheduleStaged: 0,
    stagedDateUpdated: 0,
    courseImport: EMPTY_COURSE_IMPORT,
  };
  if (parsedEvents.length === 0) return result;

  // CANVAS-LITE-04: every Canvas course id this feed mentions goes through
  // the SAME shared auto-import core the token path uses, BEFORE mapping
  // resolution below -- so a course seen for the first time via the feed
  // is immediately available to link/stage its own assignments in this
  // same run, not just on a second reconcile. The feed carries no
  // computed-grade at all, and no course name/code THROUGH ANY DOCUMENTED
  // FIELD -- only the bracket-suffix convention above, when present.
  const labelByCourseId = new Map<string, string>();
  for (const event of parsedEvents) {
    if (labelByCourseId.has(event.canvasCourseId)) continue;
    const label = extractCourseLabelFromSummary(event.summary);
    if (label) labelByCourseId.set(event.canvasCourseId, label);
  }
  const uniqueCourseIds = [...new Set(parsedEvents.map((e) => e.canvasCourseId))];
  result.courseImport = await autoImportCanvasCoursesAsClassesCore(
    supabase,
    userId,
    uniqueCourseIds.map((canvasCourseId) => {
      const label = labelByCourseId.get(canvasCourseId) ?? null;
      return {
        canvasCourseId,
        // A real-looking label (e.g. "CS 3345.001") when the feed's own
        // bracket convention gave us one; an honest, clearly-a-placeholder
        // name otherwise -- never a guess dressed up as a real course name.
        name: label ?? `Canvas course ${canvasCourseId}`,
        courseCode: label,
        computedCurrentScore: null,
        computedFinalScore: null,
        computedCurrentLetterGrade: null,
      };
    }),
  );

  const courses = await getMappedCourses(supabase, userId);
  const classIdByCourseId = new Map(courses.map((c) => [c.canvasCourseId, c.classId]));

  const assignmentIds = parsedEvents.map((e) => e.canvasAssignmentId);
  const { data: stagedRows, error: stagedError } = await supabase.from("staging_batches").select("id, canvas_assignment_id").eq("user_id", userId).in("canvas_assignment_id", assignmentIds);
  if (stagedError) throw stagedError;
  const stagedIds = new Set((stagedRows ?? []).map((r) => r.canvas_assignment_id as string));
  const stagedBatchByAssignment = new Map((stagedRows ?? []).map((r) => [r.canvas_assignment_id as string, r.id as string]));

  const eventsByClassId = new Map<string, ParsedAssignmentEvent[]>();
  for (const event of parsedEvents) {
    const classId = classIdByCourseId.get(event.canvasCourseId);
    if (!classId) {
      result.unmapped++;
      continue;
    }
    if (!eventsByClassId.has(classId)) eventsByClassId.set(classId, []);
    eventsByClassId.get(classId)!.push(event);
  }

  for (const [classId, events] of eventsByClassId) {
    const { data: rows, error: assessmentsError } = await supabase.from("class_assessments").select("id, canvas_assignment_id, name, date, type, points_earned, points_source").eq("user_id", userId).eq("class_id", classId);
    if (assessmentsError) throw assessmentsError;

    const assessments: LocalAssessment[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      canvasAssignmentId: r.canvas_assignment_id as string | null,
      name: r.name as string,
      date: r.date as string,
      pointsEarned: r.points_earned as number | null,
      pointsSource: r.points_source as string | null,
    }));
    const typeById = new Map((rows ?? []).map((r) => [r.id as string, (r.type as string | null) ?? "homework_assignment"]));
    const byCanvasId = new Map(assessments.filter((a) => a.canvasAssignmentId).map((a) => [a.canvasAssignmentId as string, a]));
    let unlinked = assessments.filter((a) => !a.canvasAssignmentId);

    for (const event of events) {
      const linked = byCanvasId.get(event.canvasAssignmentId);
      if (linked) {
        // The assignment is already the person's own assessment, so a date that moved in Canvas is a CHANGE for them to confirm.
        if (event.dateStr && linked.date && event.dateStr !== linked.date) await stageReschedule(supabase, userId, classId, linked, typeById.get(linked.id) ?? "homework_assignment", event.dateStr, result);
        result.alreadyCovered++;
        continue;
      }
      if (stagedIds.has(event.canvasAssignmentId)) {
        // Still pending in staging: the staged date follows the feed (a confirmed one is already an assessment, handled above).
        const batchId = stagedBatchByAssignment.get(event.canvasAssignmentId);
        if (batchId && event.dateStr) await updatePendingStagedDate(supabase, userId, batchId, event.dateStr, result);
        result.alreadyCovered++;
        continue;
      }

      const match = event.summary ? findUnambiguousLocalMatch(unlinked, event.summary, event.dateStr) : null;
      if (match) {
        const { error } = await supabase.from("class_assessments").update({ canvas_assignment_id: event.canvasAssignmentId }).eq("id", match.id).eq("user_id", userId);
        if (error) throw error;
        unlinked = unlinked.filter((a) => a.id !== match.id);
        result.linkedToExisting++;
        continue;
      }

      const item: ExtractedItem = {
        name: event.summary ?? `Canvas assignment ${event.canvasAssignmentId}`,
        type: "homework_assignment",
        date: event.dateStr,
        confidence: 1,
        sourceSnippet: null,
      };
      const batchId = await createStagingBatchCore(supabase, userId, classId, "canvas_assignment", undefined, undefined, event.canvasAssignmentId);
      await createStagedDeliverablesCore(supabase, userId, batchId, [item]);
      result.newlyStaged++;
    }
  }

  return result;
}

/** A date that moved for an item still waiting in a pending batch: update the staged row in place. Rows already committed to an assessment are never touched. */
async function updatePendingStagedDate(supabase: SupabaseClient, userId: string, batchId: string, newDate: string, result: IcsReconcileResult): Promise<void> {
  const { data, error } = await supabase.from("staged_deliverables").select("id, date").eq("user_id", userId).eq("batch_id", batchId).is("committed_assessment_id", null);
  if (error) throw error;
  for (const row of (data ?? []) as { id: string; date: string | null }[]) {
    if (row.date === newDate) continue;
    const { error: updateError } = await supabase.from("staged_deliverables").update({ date: newDate }).eq("id", row.id).eq("user_id", userId).is("committed_assessment_id", null);
    if (updateError) throw updateError;
    result.stagedDateUpdated++;
  }
}

/**
 * A due date moved in Canvas for an assessment the person already has: stage a CHANGE (a staged deliverable that REPLACES that assessment,
 * migration 282) in a batch they review and confirm, the way an announcement's "rescheduled" is staged. The stored date is never overwritten
 * silently. A change already waiting for this assessment follows the feed in place; a change proposed before (the batch persists after a
 * confirm or a reject, with the exact text below) is not proposed again.
 */
async function stageReschedule(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  assessment: LocalAssessment,
  type: string,
  newDate: string,
  result: IcsReconcileResult,
): Promise<void> {
  const { data: pending, error: pendingError } = await supabase
    .from("staged_deliverables")
    .select("id, date")
    .eq("user_id", userId)
    .eq("replaces_assessment_id", assessment.id)
    .is("committed_assessment_id", null);
  if (pendingError) throw pendingError;
  const waiting = (pending ?? []) as { id: string; date: string | null }[];
  if (waiting.length > 0) {
    for (const row of waiting) {
      if (row.date === newDate) continue;
      const { error } = await supabase.from("staged_deliverables").update({ date: newDate }).eq("id", row.id).eq("user_id", userId).is("committed_assessment_id", null);
      if (error) throw error;
      result.stagedDateUpdated++;
    }
    return;
  }

  const marker = `Canvas calendar: "${assessment.name}" moved from ${assessment.date} to ${newDate} (change ${assessment.id})`;
  const { data: proposedBefore, error: seenError } = await supabase.from("staging_batches").select("id").eq("user_id", userId).eq("raw_text", marker).limit(1);
  if (seenError) throw seenError;
  if ((proposedBefore ?? []).length > 0) return;

  const batchId = await createStagingBatchCore(supabase, userId, classId, "announcement", marker);
  const item: ExtractedItem = {
    name: assessment.name,
    type: type as ExtractedItem["type"],
    date: newDate,
    confidence: 1,
    sourceSnippet: null,
    replacesAssessmentId: assessment.id,
  };
  await createStagedDeliverablesCore(supabase, userId, batchId, [item]);
  result.rescheduleStaged++;
}
