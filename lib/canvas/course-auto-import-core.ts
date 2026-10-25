import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanvasCourseSummary } from "@/lib/canvas/client";
import { findUnambiguousClassMatch, type LocalClassRow } from "@/lib/canvas/sync-core";
import { createClassCore } from "@/lib/school/actions-core";
import { findClassByCourseNumber } from "@/lib/canvas/course-number";

/**
 * CANVAS-LITE-03 — the user's own instruction, reading ENG3's CANVAS-GAP-05
 * finding: "if the user's Canvas API is connected, then their classes
 * should automatically be added in." Own file, not sync-core.ts: this is a
 * third, related-but-distinct concern (course-to-class import) alongside
 * that file's two existing poll jobs (grades, announcements), the same
 * separation lib/canvas/ics-reconcile-core.ts already keeps for its own
 * concern while still reusing sync-core.ts's shared match logic.
 *
 * Called from BOTH `connectCanvas` (a single connect step now populates
 * School, not connect-then-remember-to-sync) AND `refreshCanvasCourses`
 * (the ongoing "Sync courses" / ICS-reconciliation-adjacent path) against
 * the same active-course list — one implementation, so idempotency holds
 * by construction rather than by convention: re-running either is a no-op
 * for anything already resolved (linked or dismissed).
 */

export interface AutoImportCoursesResult {
  created: number;
  adopted: number;
  alreadyLinked: number;
  skippedDismissed: number;
}

/**
 * `classes.code` is NOT NULL — an auto-created class from a Canvas course
 * with no `course_code` needs SOMETHING. Deterministic (same input always
 * produces the same output, so a retry never invents a different code for
 * the same course), never the Canvas id (that's an opaque number, not a
 * course code a student would recognize), never empty — and always
 * editable afterwards (CANVAS-LITE-03's own code-editability change).
 * Initials of the course name's words read as an actual course-code shape
 * ("OCI" for "Organic Chemistry II"); a single/unsplittable word falls
 * back to itself, capped and uppercased.
 */
export function deriveClassCode(courseName: string): string {
  const words = courseName.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const initials = words.map((w) => w[0]!.toUpperCase()).join("");
  if (initials.length >= 2) return initials.slice(0, 10);
  const stripped = courseName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase();
  return stripped || "CLASS";
}

async function createAutoImportedClass(supabase: SupabaseClient, userId: string, course: CanvasCourseSummary): Promise<string> {
  return createClassCore(supabase, userId, {
    shortName: course.name,
    code: course.courseCode ?? deriveClassCode(course.name),
  });
}

/**
 * Per active Canvas course: already linked -> class_id untouched; mapping
 * exists but dismissed (the user deleted/unlinked what auto-import
 * created before) -> resolution skipped, removal sticks; otherwise ->
 * `findUnambiguousClassMatch` against the user's own classes (adopt a
 * hand-made class, never duplicate it) or, failing that, a brand-new
 * class via `createClassCore`.
 *
 * CANVAS-GAP-01: EVERY course's mapping row is upserted every call now,
 * not just an unresolved one -- name/code AND the computed-grade snapshot
 * (`computedCurrentScore`/`computedFinalScore`/`computedCurrentLetterGrade`,
 * `computed_grade_synced_at`) must stay fresh on every sync regardless of
 * link state, or an already-linked course's grade snapshot would go stale
 * forever after the first link. `class_id` is the only field that stays
 * scoped to the unresolved subset -- an already-linked or dismissed
 * mapping's `class_id` is never touched (omitted from that payload).
 */
export async function autoImportCanvasCoursesAsClassesCore(supabase: SupabaseClient, userId: string, courses: CanvasCourseSummary[]): Promise<AutoImportCoursesResult> {
  const result: AutoImportCoursesResult = { created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 };
  if (courses.length === 0) return result;

  const { data: mappingRows, error: mappingError } = await supabase
    .from("canvas_course_mappings")
    .select("canvas_course_id, class_id, dismissed_at")
    .eq("user_id", userId)
    .in(
      "canvas_course_id",
      courses.map((c) => c.canvasCourseId),
    );
  if (mappingError) throw mappingError;
  const mappingByCourse = new Map((mappingRows ?? []).map((r) => [r.canvas_course_id as string, r]));

  const needsResolution = new Set(
    courses
      .filter((course) => {
        const mapping = mappingByCourse.get(course.canvasCourseId);
        if (!mapping) return true; // never seen before
        if (mapping.class_id) {
          result.alreadyLinked++;
          return false;
        }
        if (mapping.dismissed_at) {
          result.skippedDismissed++;
          return false;
        }
        return true; // seen, unlinked, not dismissed
      })
      .map((c) => c.canvasCourseId),
  );

  let localClasses: LocalClassRow[] = [];
  if (needsResolution.size > 0) {
    const { data: classRows, error: classesError } = await supabase.from("classes").select("id, short_name, code").eq("user_id", userId);
    if (classesError) throw classesError;
    localClasses = (classRows ?? []).map((c) => ({ id: c.id as string, shortName: c.short_name as string | null, code: c.code as string }));
  }

  const now = new Date().toISOString();
  for (const course of courses) {
    const upsertPayload: Record<string, unknown> = {
      user_id: userId,
      canvas_course_id: course.canvasCourseId,
      canvas_course_name: course.name,
      canvas_course_code: course.courseCode,
      computed_current_score: course.computedCurrentScore,
      computed_final_score: course.computedFinalScore,
      computed_current_letter_grade: course.computedCurrentLetterGrade,
      computed_grade_synced_at: now,
      updated_at: now,
    };

    if (needsResolution.has(course.canvasCourseId)) {
      // Same name/code first; then the course NUMBER ("CS 3345.HON - F26" is the person's "CS-3345-HON"), so a feed or Canvas label never
      // spawns a duplicate of a class they already have. Zero or ambiguous matches create, as before.
      const match = findUnambiguousClassMatch(localClasses, course.name, course.courseCode) ?? findClassByCourseNumber(localClasses, [course.name, course.courseCode]);
      const classId = match ? match.id : await createAutoImportedClass(supabase, userId, course);
      upsertPayload.class_id = classId;
      if (match) result.adopted++;
      else result.created++;
    }

    const { error } = await supabase.from("canvas_course_mappings").upsert(upsertPayload, { onConflict: "user_id,canvas_course_id" });
    if (error) throw error;
  }
  return result;
}
