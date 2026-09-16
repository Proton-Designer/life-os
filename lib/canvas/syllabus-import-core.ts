import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { stripHtml } from "@/lib/canvas/sync-core";
import { extractDeliverablesFromText } from "@/lib/school/syllabus-extraction";
import { createStagingBatchCore, createStagedDeliverablesCore } from "@/lib/school/staging-core";

/**
 * CANVAS-GAP-02 (ENG3's CANVAS-VERIFY-01 live probe): a token-connected
 * user's syllabus is already sitting in Canvas as fetchable HTML
 * (`syllabus_body`) -- requiring a separate manual PDF upload (Phase 1's
 * own SyllabusPanel flow) is unnecessary friction for exactly the users
 * who connected a token for LESS manual work. This feeds the SAME
 * `extractDeliverablesFromText` the manual-upload path uses (no new
 * extraction logic, no new confirm/reject UI -- a Canvas-sourced syllabus
 * lands in the identical staging-review pipeline as a pasted/uploaded one)
 * and reuses sync-core.ts's own `stripHtml` (the exact same "untrusted
 * Canvas HTML into the LLM prompt" shape the announcement path already
 * has) rather than a second HTML-to-text implementation.
 *
 * Manual PDF upload is completely unaffected -- this is an ADDITIONAL
 * path (a separate action, a separate button), never a replacement, and
 * still the only option for a course whose Canvas syllabus is empty or
 * unhelpful.
 */

export type CanvasSyllabusImportOutcome =
  | { outcome: "extracted"; batchId: string; itemCount: number; truncated: boolean }
  /** Canvas genuinely allows an empty syllabus_body, and a real one can still be too short to be worth an LLM call (a one-line "see the LMS front page" placeholder) -- both read as an honest "nothing to import here" to the caller, never a silent no-op button with no feedback at all. */
  | { outcome: "empty" }
  | { outcome: "no_key" }
  | { outcome: "unavailable" }
  | { outcome: "parse_failed" };

/** Same threshold and reasoning as the manual PDF path's own `MIN_EXTRACTABLE_TEXT_LENGTH` (syllabus-extraction-actions.ts): below this, stripped text is almost certainly not a real syllabus, not a short-but-legitimate one -- decided before ever spending a gateway call. */
const MIN_SYLLABUS_TEXT_LENGTH = 200;

export async function importCanvasSyllabusCore(
  supabase: SupabaseClient,
  userId: string,
  classId: string,
  timezone: string,
  now: Date,
  syllabusHtml: string | null,
): Promise<CanvasSyllabusImportOutcome> {
  if (!syllabusHtml) return { outcome: "empty" };

  const text = stripHtml(syllabusHtml);
  if (text.length < MIN_SYLLABUS_TEXT_LENGTH) return { outcome: "empty" };

  const todayStr = localDateString(now, timezone);
  const result = await extractDeliverablesFromText(supabase, userId, text, todayStr);
  if (result.status !== "extracted") return { outcome: result.status };

  // "syllabus" -- the SAME staging source the manual PDF/paste path uses
  // (syllabus-extraction-actions.ts), never a distinct Canvas-specific
  // source: this is the same review pipeline, only the input differs.
  const batchId = await createStagingBatchCore(supabase, userId, classId, "syllabus");
  await createStagedDeliverablesCore(supabase, userId, batchId, result.items);
  return { outcome: "extracted", batchId, itemCount: result.items.length, truncated: result.truncated };
}
