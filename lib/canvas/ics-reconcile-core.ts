import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCanvasIcsFeed, icsDateStrToLocalDateString } from "@/lib/canvas/ics-parser";
import { getMappedCourses, findUnambiguousLocalMatch, type LocalAssessment } from "@/lib/canvas/sync-core";
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
}

interface ParsedAssignmentEvent {
  canvasCourseId: string;
  canvasAssignmentId: string;
  summary: string | null;
  dateStr: string | null;
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

  const result: IcsReconcileResult = { parsedAssignmentEvents: parsedEvents.length, alreadyCovered: 0, linkedToExisting: 0, unmapped: 0, newlyStaged: 0 };
  if (parsedEvents.length === 0) return result;

  const courses = await getMappedCourses(supabase, userId);
  const classIdByCourseId = new Map(courses.map((c) => [c.canvasCourseId, c.classId]));

  const assignmentIds = parsedEvents.map((e) => e.canvasAssignmentId);
  const { data: stagedRows, error: stagedError } = await supabase.from("staging_batches").select("canvas_assignment_id").eq("user_id", userId).in("canvas_assignment_id", assignmentIds);
  if (stagedError) throw stagedError;
  const stagedIds = new Set((stagedRows ?? []).map((r) => r.canvas_assignment_id as string));

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
    const { data: rows, error: assessmentsError } = await supabase.from("class_assessments").select("id, canvas_assignment_id, name, date, points_earned, points_source").eq("user_id", userId).eq("class_id", classId);
    if (assessmentsError) throw assessmentsError;

    const assessments: LocalAssessment[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      canvasAssignmentId: r.canvas_assignment_id as string | null,
      name: r.name as string,
      date: r.date as string,
      pointsEarned: r.points_earned as number | null,
      pointsSource: r.points_source as string | null,
    }));
    const byCanvasId = new Map(assessments.filter((a) => a.canvasAssignmentId).map((a) => [a.canvasAssignmentId as string, a]));
    let unlinked = assessments.filter((a) => !a.canvasAssignmentId);

    for (const event of events) {
      if (byCanvasId.has(event.canvasAssignmentId) || stagedIds.has(event.canvasAssignmentId)) {
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
