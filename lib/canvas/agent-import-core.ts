import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { getMappedCourses, processCanvasAssignment, type CanvasAssignmentSyncState, type LocalAssessment } from "@/lib/canvas/sync-core";
import { stageAnnouncementCore } from "@/lib/school/announcement-extraction-core";

/**
 * CANVAS-LITE-02 — the agent-facing counterpart to lib/canvas/sync-core.ts's
 * two token-based poll jobs, for students whose school blocks Canvas access
 * tokens (CANVAS-LITE-01's own header). An external agent (a scheduled
 * cloud task under the user's own AI platform) logs into Canvas on its own
 * side and sends ONE bulk batch instead of many single writes; this module
 * never talks to Canvas itself and never sees a Canvas credential — see
 * lib/mcp/write-registry.ts's `school.canvas_import.run_batch`, the only
 * caller, for the transport/auth/rate-limit layer.
 *
 * Every write path here reuses an EXISTING core, never a second
 * implementation of the same rule: `processCanvasAssignment` (extracted
 * from `syncCanvasGradesCore` in this same PR, behavior-preserving) for
 * assessments, and `stageAnnouncementCore` (P2-07's own LLM-extraction
 * pipeline, already shared with the token-based announcement poller) for
 * announcements. The never-overwrite-a-grade guard and the
 * unambiguous-local-match rule can therefore never drift between the
 * token path and this one.
 */

export const CANVAS_IMPORT_MAX_ITEMS = 200;

export interface CanvasImportCourseItem {
  kind: "course";
  canvasCourseId: string;
  canvasCourseName: string;
  canvasCourseCode: string | null;
}

export interface CanvasImportAssessmentItem {
  kind: "assessment";
  canvasCourseId: string;
  canvasAssignmentId: string;
  name: string;
  dueAt: string | null;
  pointsPossible: number | null;
  pointsEarned: number;
  /**
   * CANVAS-GAP-03: optional, defaults to `null` (never auto-grades) when
   * omitted -- an agent that doesn't state a grading type gets the SAME
   * conservative treatment as an unrecognized Canvas type, never an
   * assumed "points". See processCanvasAssignment's own header
   * (lib/canvas/sync-core.ts) for the full per-type reasoning.
   */
  gradingType: string | null;
}

export interface CanvasImportAnnouncementItem {
  kind: "announcement";
  canvasCourseId: string;
  canvasAnnouncementId: string;
  text: string;
}

export type CanvasImportItem = CanvasImportCourseItem | CanvasImportAssessmentItem | CanvasImportAnnouncementItem;

/**
 * One real outcome per item, never one opaque batch success (the AC's own
 * words). `ref` is the caller's own Canvas id for that item -- the same
 * stable id the caller already used to key the item, so a caller can match
 * a result back to what it sent without us inventing a second id scheme.
 */
export interface CanvasImportItemResult {
  kind: CanvasImportItem["kind"];
  ref: string;
  outcome: "created" | "updated" | "skipped";
  reason?: string;
}

export interface CanvasImportBatchResult {
  results: CanvasImportItemResult[];
  counts: { created: number; updated: number; skipped: number };
}

/** Case-insensitive, whitespace-collapsed -- same normalization posture as sync-core.ts's own `normalizeTitle`, reused here for course-name/code matching rather than re-deriving the rule. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

interface LocalClassRow {
  id: string;
  shortName: string | null;
  code: string | null;
}

/**
 * Never auto-creates a `classes` row -- a class is something the user set
 * up (same posture as never auto-creating an assessment). Maps only when
 * the Canvas course's own name/code matches EXACTLY ONE of the user's
 * classes' short_name/code, case-insensitively; anything ambiguous or
 * absent is left unmapped for the user to resolve in Settings
 * (CANVAS-LITE-03's own scope).
 */
function findUnambiguousClassMatch(classes: LocalClassRow[], courseName: string, courseCode: string | null): LocalClassRow | null {
  const candidates = [normalize(courseName), ...(courseCode ? [normalize(courseCode)] : [])];
  const matches = classes.filter((c) => {
    const fields = [c.shortName ? normalize(c.shortName) : null, c.code ? normalize(c.code) : null].filter((f): f is string => f !== null);
    return fields.some((f) => candidates.includes(f));
  });
  const uniqueIds = new Set(matches.map((c) => c.id));
  if (uniqueIds.size !== 1) return null;
  return matches[0]!;
}

async function processCourseItem(supabase: SupabaseClient, userId: string, item: CanvasImportCourseItem, localClasses: LocalClassRow[]): Promise<CanvasImportItemResult> {
  const { data: existing, error: existingError } = await supabase
    .from("canvas_course_mappings")
    .select("class_id")
    .eq("user_id", userId)
    .eq("canvas_course_id", item.canvasCourseId)
    .maybeSingle();
  if (existingError) throw existingError;

  const now = new Date().toISOString();
  // class_id deliberately absent from the base upsert payload -- same
  // reasoning as refreshCanvasCourses' own upsert (app/(app)/settings/
  // canvas-actions.ts): PostgREST only touches columns present in the
  // body, so refreshing name/code can never silently null out a mapping
  // the user (or a prior auto-map below) already made.
  const upsertPayload: Record<string, unknown> = {
    user_id: userId,
    canvas_course_id: item.canvasCourseId,
    canvas_course_name: item.canvasCourseName,
    canvas_course_code: item.canvasCourseCode,
    updated_at: now,
  };

  let autoMappedClassId: string | null = null;
  if (!existing?.class_id) {
    const match = findUnambiguousClassMatch(localClasses, item.canvasCourseName, item.canvasCourseCode);
    if (match) {
      upsertPayload.class_id = match.id;
      autoMappedClassId = match.id;
    }
  }

  const { error } = await supabase.from("canvas_course_mappings").upsert(upsertPayload, { onConflict: "user_id,canvas_course_id" });
  if (error) throw error;

  if (!existing) {
    return {
      kind: "course",
      ref: item.canvasCourseId,
      outcome: "created",
      reason: autoMappedClassId ? `new mapping, auto-mapped to local class ${autoMappedClassId}` : "new mapping, not yet mapped to a local class",
    };
  }
  return {
    kind: "course",
    ref: item.canvasCourseId,
    outcome: "updated",
    reason: autoMappedClassId ? `auto-mapped to local class ${autoMappedClassId}` : "refreshed name/code",
  };
}

async function loadAssignmentSyncState(supabase: SupabaseClient, userId: string, classId: string, assignmentIds: string[]): Promise<CanvasAssignmentSyncState> {
  const { data: rows, error: assessmentsError } = await supabase
    .from("class_assessments")
    .select("id, canvas_assignment_id, name, date, points_earned, points_source")
    .eq("user_id", userId)
    .eq("class_id", classId);
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
  const unlinked = assessments.filter((a) => !a.canvasAssignmentId);

  const { data: existingStaged, error: stagedError } = await supabase
    .from("staging_batches")
    .select("canvas_assignment_id")
    .eq("user_id", userId)
    .in("canvas_assignment_id", assignmentIds);
  if (stagedError) throw stagedError;
  const alreadyStagedAssignmentIds = new Set((existingStaged ?? []).map((r) => r.canvas_assignment_id as string));

  return { byCanvasId, unlinked, alreadyStagedAssignmentIds };
}

async function processAssessmentItems(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  classId: string,
  items: CanvasImportAssessmentItem[],
): Promise<CanvasImportItemResult[]> {
  const state = await loadAssignmentSyncState(supabase, userId, classId, items.map((i) => i.canvasAssignmentId));

  const results: CanvasImportItemResult[] = [];
  for (const item of items) {
    const outcome = await processCanvasAssignment(
      supabase,
      userId,
      classId,
      timezone,
      { canvasAssignmentId: item.canvasAssignmentId, name: item.name, dueAt: item.dueAt, pointsPossible: item.pointsPossible, pointsEarned: item.pointsEarned, gradingType: item.gradingType },
      state,
    );
    if (outcome.outcome === "graded") {
      results.push({ kind: "assessment", ref: item.canvasAssignmentId, outcome: "updated", reason: `grade recorded (${outcome.via} to an existing assessment)` });
    } else if (outcome.outcome === "protected") {
      results.push({ kind: "assessment", ref: item.canvasAssignmentId, outcome: "skipped", reason: "existing grade was entered by hand; Canvas value not applied" });
    } else if (outcome.outcome === "ungradable") {
      results.push({
        kind: "assessment",
        ref: item.canvasAssignmentId,
        outcome: "skipped",
        reason: "grading type isn't points-comparable (pass/fail, letter grade, GPA scale, or not stated) -- no grade applied",
      });
    } else if (outcome.outcome === "staged") {
      results.push({ kind: "assessment", ref: item.canvasAssignmentId, outcome: "created", reason: "no unambiguous local match; staged for review" });
    } else {
      results.push({ kind: "assessment", ref: item.canvasAssignmentId, outcome: "skipped", reason: "already staged from a prior import" });
    }
  }
  return results;
}

async function processAnnouncementItem(supabase: SupabaseClient, userId: string, timezone: string, now: Date, classId: string, item: CanvasImportAnnouncementItem): Promise<CanvasImportItemResult> {
  // Same avoid-a-wasted-LLM-call pre-filter as syncCanvasAnnouncementsCore's
  // own loop -- createStagingBatchCore is a plain INSERT (no ON CONFLICT DO
  // NOTHING), so idempotency for a repeat announcement id comes from this
  // check, not the database.
  const { data: existing, error: existingError } = await supabase
    .from("staging_batches")
    .select("id")
    .eq("user_id", userId)
    .eq("canvas_announcement_id", item.canvasAnnouncementId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return { kind: "announcement", ref: item.canvasAnnouncementId, outcome: "skipped", reason: "already staged from a prior import" };
  }

  const todayStr = localDateString(now, timezone);
  const outcome = await stageAnnouncementCore(supabase, userId, classId, item.text, todayStr, item.canvasAnnouncementId);
  if (outcome.outcome === "extracted") {
    return { kind: "announcement", ref: item.canvasAnnouncementId, outcome: "created", reason: `staged ${outcome.itemCount} item(s) for review` };
  }
  const reason: Record<Exclude<typeof outcome.outcome, "extracted">, string> = {
    too_short: "announcement text too short to extract anything from",
    no_key: "no usable AI key configured for extraction",
    unavailable: "extraction is currently unavailable",
    parse_failed: "couldn't parse the announcement text",
  };
  return { kind: "announcement", ref: item.canvasAnnouncementId, outcome: "skipped", reason: reason[outcome.outcome] };
}

/**
 * The single entry point `school.canvas_import.run_batch` calls. Course
 * items are processed FIRST (and in full) so assessment/announcement items
 * in the SAME batch can resolve a course this batch itself just mapped —
 * an agent seeing a brand-new course for the first time can send its
 * mapping and its assignments in one call rather than needing a prior
 * round-trip.
 */
export async function runCanvasImportBatchCore(supabase: SupabaseClient, userId: string, timezone: string, now: Date, items: CanvasImportItem[]): Promise<CanvasImportBatchResult> {
  const results: CanvasImportItemResult[] = [];

  const courseItems = items.filter((i): i is CanvasImportCourseItem => i.kind === "course");
  const assessmentItems = items.filter((i): i is CanvasImportAssessmentItem => i.kind === "assessment");
  const announcementItems = items.filter((i): i is CanvasImportAnnouncementItem => i.kind === "announcement");

  if (courseItems.length > 0) {
    const { data: classRows, error: classesError } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId);
    if (classesError) throw classesError;
    const localClasses: LocalClassRow[] = (classRows ?? []).map((c) => ({ id: c.id as string, shortName: c.short_name as string | null, code: c.code as string | null }));
    for (const item of courseItems) {
      results.push(await processCourseItem(supabase, userId, item, localClasses));
    }
  }

  if (assessmentItems.length > 0 || announcementItems.length > 0) {
    const mapped = await getMappedCourses(supabase, userId);
    const classIdByCourse = new Map(mapped.map((c) => [c.canvasCourseId, c.classId]));

    const assessmentsByClass = new Map<string, CanvasImportAssessmentItem[]>();
    for (const item of assessmentItems) {
      const classId = classIdByCourse.get(item.canvasCourseId);
      if (!classId) {
        results.push({ kind: "assessment", ref: item.canvasAssignmentId, outcome: "skipped", reason: "course not mapped to a local class" });
        continue;
      }
      const bucket = assessmentsByClass.get(classId) ?? [];
      bucket.push(item);
      assessmentsByClass.set(classId, bucket);
    }
    for (const [classId, classItems] of assessmentsByClass) {
      results.push(...(await processAssessmentItems(supabase, userId, timezone, classId, classItems)));
    }

    for (const item of announcementItems) {
      const classId = classIdByCourse.get(item.canvasCourseId);
      if (!classId) {
        results.push({ kind: "announcement", ref: item.canvasAnnouncementId, outcome: "skipped", reason: "course not mapped to a local class" });
        continue;
      }
      results.push(await processAnnouncementItem(supabase, userId, timezone, now, classId, item));
    }
  }

  const counts = { created: 0, updated: 0, skipped: 0 };
  for (const r of results) counts[r.outcome]++;
  return { results, counts };
}
