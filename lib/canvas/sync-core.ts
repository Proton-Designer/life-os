import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { fetchCanvasAnnouncements, fetchCanvasGradedAssignments } from "@/lib/canvas/client";
import { resolveCanvasConnectionCore, recordCanvasSyncOutcomeCore } from "@/lib/canvas/connection-core";
import { stageAnnouncementCore } from "@/lib/school/announcement-extraction-core";
import { createStagingBatchCore, createStagedDeliverablesCore } from "@/lib/school/staging-core";
import type { ExtractedItem } from "@/lib/school/syllabus-extraction";

/**
 * P2-21 — the two Canvas poll jobs (announcements → P2-07's staged-diff
 * pipeline; grades → direct write with Opus Lead's never-overwrite guard).
 * Both take a single userId and loop over THAT user's mapped courses; the
 * cron route (app/api/cron/canvas-sync/route.ts) owns looping over many
 * users and the per-run cap.
 *
 * Both functions resolve the connection and write canvas_connections' sync
 * status via lib/canvas/connection-core.ts's shared helpers -- the exact
 * same three-way discipline (decrypt-throw → 'expired'; fetch-failure →
 * last_sync_error only; success → stamp last_synced_at) the "Sync courses"
 * button (app/(app)/settings/canvas-actions.ts) already established.
 * ONE COURSE'S FAILURE NEVER BLOCKS ANOTHER: a fetch error for course A is
 * recorded (last written wins for the connection-level last_sync_error --
 * there is only one such column per connection, not per course, same
 * scoping P2-22's own header already chose) and the loop continues to
 * course B, rather than aborting the whole sync over one course's problem.
 */

interface MappedCourse {
  canvasCourseId: string;
  classId: string;
}

async function getMappedCourses(supabase: SupabaseClient, userId: string): Promise<MappedCourse[]> {
  const { data, error } = await supabase
    .from("canvas_course_mappings")
    .select("canvas_course_id, class_id")
    .eq("user_id", userId)
    .not("class_id", "is", null);
  if (error) throw error;
  return (data ?? []).map((r) => ({ canvasCourseId: r.canvas_course_id as string, classId: r.class_id as string }));
}

/** Canvas announcement `message` is HTML -- a minimal strip-to-text, same posture as feeding any other untrusted free text into the LLM extraction step (announcement-extraction.ts's own prompt already handles informal, messy phrasing). Not a full HTML parser: good enough for "readable plain text," not byte-perfect. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** No connection at all, or the connection's token is already known-expired -- both mean "nothing to sync," not a failure worth a sync-status write (P2-22's expiry path already told the user; re-announcing it on every poll tick would be noise). */
async function connectedAndUsable(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("canvas_connections").select("token_status").eq("user_id", userId).maybeSingle();
  return data?.token_status === "ok";
}

export type CanvasAnnouncementSyncResult = { ok: true; staged: number } | { ok: false };

const ANNOUNCEMENT_POLL_WINDOW_DAYS = 14;

/**
 * Per mapped course: fetch announcements posted in the last
 * ANNOUNCEMENT_POLL_WINDOW_DAYS, skip any already staged (a cheap
 * pre-filter query against migration 189's own dedup column -- avoids
 * spending an LLM extraction call on an announcement this account has
 * already seen), stage the rest via stageAnnouncementCore (P2-07's own
 * pipeline, unchanged).
 */
export async function syncCanvasAnnouncementsCore(supabase: SupabaseClient, userId: string, timezone: string, now: Date): Promise<CanvasAnnouncementSyncResult> {
  if (!(await connectedAndUsable(supabase, userId))) return { ok: false };

  let conn: Awaited<ReturnType<typeof resolveCanvasConnectionCore>>;
  try {
    conn = await resolveCanvasConnectionCore(supabase, userId);
  } catch {
    await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "decrypt_failed" });
    return { ok: false };
  }
  if (!conn) return { ok: false };

  const courses = await getMappedCourses(supabase, userId);
  if (courses.length === 0) {
    await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "ok" });
    return { ok: true, staged: 0 };
  }

  const sinceIso = new Date(now.getTime() - ANNOUNCEMENT_POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const todayStr = localDateString(now, timezone);
  let staged = 0;
  let anyFailure = false;

  for (const course of courses) {
    let res;
    try {
      res = await fetchCanvasAnnouncements(conn.instanceUrl, conn.token, course.canvasCourseId, sinceIso);
    } catch (err) {
      anyFailure = true;
      await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "sync_failed", message: err instanceof Error ? err.message : "Sync failed unexpectedly. Try again." });
      continue;
    }
    if (!res.ok) {
      anyFailure = true;
      await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "sync_failed", message: res.message, authExpired: res.authExpired });
      continue;
    }
    if (res.data.length === 0) continue;

    const ids = res.data.map((a) => a.canvasAnnouncementId);
    const { data: existing, error: existingError } = await supabase.from("staging_batches").select("canvas_announcement_id").eq("user_id", userId).in("canvas_announcement_id", ids);
    if (existingError) throw existingError;
    const alreadyStaged = new Set((existing ?? []).map((r) => r.canvas_announcement_id as string));

    for (const announcement of res.data) {
      if (alreadyStaged.has(announcement.canvasAnnouncementId)) continue;
      const text = stripHtml(announcement.messageHtml || announcement.title);
      const outcome = await stageAnnouncementCore(supabase, userId, course.classId, text, todayStr, announcement.canvasAnnouncementId);
      if (outcome.outcome === "extracted") staged++;
    }
  }

  if (!anyFailure) await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "ok" });
  return { ok: true, staged };
}

export type CanvasGradeSyncResult = { ok: true; graded: number; staged: number } | { ok: false };

interface LocalAssessment {
  id: string;
  canvasAssignmentId: string | null;
  name: string;
  date: string;
  pointsEarned: number | null;
  pointsSource: string | null;
}

/** Case-insensitive, whitespace-collapsed -- the same "close enough to be the same title" normalization this Lead ruling's "exact normalized title" phrase calls for, without being so loose it risks a false-positive match. */
function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True only when overwriting points_earned is safe -- migration 189's own invariant, restated once here rather than inlined at each call site. */
function canOverwriteGrade(existing: { pointsEarned: number | null; pointsSource: string | null }): boolean {
  return existing.pointsEarned === null || existing.pointsSource === "canvas";
}

/**
 * Per mapped course, per graded Canvas assignment: (a) already linked by
 * canvas_assignment_id -> direct update, respecting the never-overwrite
 * guard; (b) unlinked but an UNAMBIGUOUS local match exists (exact
 * normalized title, or -- if that's ambiguous or absent -- a single
 * due-date match) among this class's still-unlinked assessments -> link +
 * grade, same guard; (c) no unambiguous match -> stage it (never
 * auto-create), deduped/tombstoned against a prior stage (pending OR
 * already rejected -- see migration 194's own header) via
 * staging_batches.canvas_assignment_id.
 */
export async function syncCanvasGradesCore(supabase: SupabaseClient, userId: string, timezone: string, now: Date): Promise<CanvasGradeSyncResult> {
  if (!(await connectedAndUsable(supabase, userId))) return { ok: false };

  let conn: Awaited<ReturnType<typeof resolveCanvasConnectionCore>>;
  try {
    conn = await resolveCanvasConnectionCore(supabase, userId);
  } catch {
    await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "decrypt_failed" });
    return { ok: false };
  }
  if (!conn) return { ok: false };

  const courses = await getMappedCourses(supabase, userId);
  if (courses.length === 0) {
    await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "ok" });
    return { ok: true, graded: 0, staged: 0 };
  }

  const todayStr = localDateString(now, timezone);
  let graded = 0;
  let staged = 0;
  let anyFailure = false;

  for (const course of courses) {
    let res;
    try {
      res = await fetchCanvasGradedAssignments(conn.instanceUrl, conn.token, course.canvasCourseId);
    } catch (err) {
      anyFailure = true;
      await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "sync_failed", message: err instanceof Error ? err.message : "Sync failed unexpectedly. Try again." });
      continue;
    }
    if (!res.ok) {
      anyFailure = true;
      await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "sync_failed", message: res.message, authExpired: res.authExpired });
      continue;
    }
    if (res.data.length === 0) continue;

    const { data: rows, error: assessmentsError } = await supabase
      .from("class_assessments")
      .select("id, canvas_assignment_id, name, date, points_earned, points_source")
      .eq("user_id", userId)
      .eq("class_id", course.classId);
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

    // Pre-filter Canvas assignments already staged-but-unconfirmed, same
    // avoid-a-wasted-write reasoning as the announcement path's own
    // pre-filter (here it's a plain insert, not an LLM call, but the
    // unique index would just reject the duplicate insert anyway --
    // pre-filtering keeps the intent explicit and skips a doomed insert).
    const assignmentIds = res.data.map((a) => a.canvasAssignmentId);
    const { data: existingStaged, error: stagedError } = await supabase
      .from("staging_batches")
      .select("canvas_assignment_id")
      .eq("user_id", userId)
      .in("canvas_assignment_id", assignmentIds);
    if (stagedError) throw stagedError;
    const alreadyStagedAssignmentIds = new Set((existingStaged ?? []).map((r) => r.canvas_assignment_id as string));

    for (const assignment of res.data) {
      const linked = byCanvasId.get(assignment.canvasAssignmentId);
      if (linked) {
        if (canOverwriteGrade(linked)) {
          const { error } = await supabase
            .from("class_assessments")
            .update({ points_earned: assignment.pointsEarned, points_possible: assignment.pointsPossible, points_source: "canvas" })
            .eq("id", linked.id)
            .eq("user_id", userId);
          if (error) throw error;
          graded++;
        }
        continue;
      }

      const normalizedTarget = normalizeTitle(assignment.name);
      const titleMatches = unlinked.filter((a) => normalizeTitle(a.name) === normalizedTarget);
      let match: LocalAssessment | null = titleMatches.length === 1 ? titleMatches[0]! : null;
      if (!match && assignment.dueAt) {
        const dueDateStr = localDateString(new Date(assignment.dueAt), timezone);
        const dateMatches = unlinked.filter((a) => a.date === dueDateStr);
        match = dateMatches.length === 1 ? dateMatches[0]! : null;
      }

      if (match) {
        const updatePayload: Record<string, unknown> = { canvas_assignment_id: assignment.canvasAssignmentId };
        if (canOverwriteGrade(match)) {
          updatePayload.points_earned = assignment.pointsEarned;
          updatePayload.points_possible = assignment.pointsPossible;
          updatePayload.points_source = "canvas";
        }
        const { error } = await supabase.from("class_assessments").update(updatePayload).eq("id", match.id).eq("user_id", userId);
        if (error) throw error;
        unlinked = unlinked.filter((a) => a.id !== match!.id);
        graded++;
        continue;
      }

      if (alreadyStagedAssignmentIds.has(assignment.canvasAssignmentId)) continue;

      const item: ExtractedItem = {
        name: assignment.name,
        // No signal to infer a finer AssessmentType from Canvas's own
        // assignment shape -- homework_assignment is this vocabulary's own
        // catch-all default, and the review UI (unchanged, P2-07's own)
        // lets the user correct it before confirming, same as any
        // AI-extracted item's type already gets corrected today.
        type: "homework_assignment",
        date: assignment.dueAt ? localDateString(new Date(assignment.dueAt), timezone) : null,
        confidence: 1,
        sourceSnippet: null,
      };
      const batchId = await createStagingBatchCore(supabase, userId, course.classId, "canvas_assignment", undefined, assignment.canvasAssignmentId);
      await createStagedDeliverablesCore(supabase, userId, batchId, [item]);
      staged++;
    }
  }

  if (!anyFailure) await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "ok" });
  return { ok: true, graded, staged };
}
