"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { loadPdf, extractPages } from "@/lib/self-mastery/ingestion/pdf";
import { repairExtractedPages } from "@/lib/self-mastery/ingestion/text-repair";
import { extractDeliverablesFromText } from "@/lib/school/syllabus-extraction";
import { createStagingBatchCore, createStagedDeliverablesCore } from "@/lib/school/staging-core";
import { resolveCanvasConnectionCore } from "@/lib/canvas/connection-core";
import { fetchCanvasCourseSyllabus } from "@/lib/canvas/client";
import { importCanvasSyllabusCore, type CanvasSyllabusImportOutcome } from "@/lib/canvas/syllabus-import-core";

/**
 * Phase 1 #16 — syllabus upload → AI extraction, the action-layer wiring. Reads
 * (imports, never edits) `lib/self-mastery/ingestion/pdf.ts`'s `loadPdf`/
 * `extractPages` and `text-repair.ts`'s `repairExtractedPages` rather than a second
 * `unpdf` implementation — Opus Lead ruling: the first real PDF this repo ever
 * ingested died on a NUL byte, and `repairExtractedPages` is the fix for exactly
 * that; forking the extraction call would re-ship that bug the moment a syllabus's
 * `source_snippet` contained one.
 *
 * PDF ONLY for Phase 1 (Opus Lead scope ruling) — the source spec's PNG/JPEG
 * formats need a vision-capable model, which depends on the multi-provider work in
 * lib/ai landing first. Logged as a known Phase 1 gap, not silently dropped.
 *
 * A `staging_batches` row is created ONLY once extraction actually runs and
 * produces a result (see `createStagingBatchCore`'s own header) — a file that
 * can't even be read, or an AI call that never ran, leaves no batch behind.
 */

export type SyllabusExtractionOutcome =
  | { outcome: "extracted"; batchId: string; itemCount: number; truncated: boolean }
  | { outcome: "unreadable" }
  | { outcome: "no_text_layer" }
  | { outcome: "no_key" }
  | { outcome: "unavailable" }
  | { outcome: "parse_failed" };

/** Below this, extracted text is almost certainly a scanned/image-only PDF with no
 * real text layer, not a short-but-legitimate syllabus — even a one-page syllabus
 * with just a title and three exam dates runs well past this in practice. Deciding
 * this BEFORE calling the gateway means a blank scan never spends a call. */
const MIN_EXTRACTABLE_TEXT_LENGTH = 200;

export async function extractSyllabusDeliverables(classId: string, formData: FormData): Promise<SyllabusExtractionOutcome> {
  const { supabase, userId } = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided");
  const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) {
    // Phase 1 scope: PDF only. The file picker itself is restricted to .pdf (see
    // the client component), so reaching this means a renamed extension or a
    // programmatic caller — a real, if unlikely, case worth a clear message rather
    // than a confusing downstream PDF-parse failure.
    throw new Error("Only PDF files are supported for automatic extraction right now.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let text: string;
  try {
    const pdf = await loadPdf(bytes);
    const pages = await extractPages(pdf);
    const repaired = repairExtractedPages(pages);
    text = repaired
      .map((p) => p.text)
      .join("\n\n")
      .trim();
  } catch {
    // EncryptedPdfError / UnreadablePdfError / TooManyPagesError all read the same
    // to the user here: this specific file could not be processed. No batch is
    // created — there is nothing to confirm and no reason to leave a row behind.
    return { outcome: "unreadable" };
  }

  if (text.length < MIN_EXTRACTABLE_TEXT_LENGTH) {
    // Decided before ever calling the gateway — a scanned/image-only PDF is not
    // "nothing schedulable found" (a lie about the syllabus) and not "add an API
    // key" (a lie about the cause).
    return { outcome: "no_text_layer" };
  }

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const result = await extractDeliverablesFromText(supabase, userId, text, todayStr);
  if (result.status !== "extracted") {
    return { outcome: result.status };
  }

  const batchId = await createStagingBatchCore(supabase, userId, classId, "syllabus");
  await createStagedDeliverablesCore(supabase, userId, batchId, result.items);

  revalidatePath("/school");
  return { outcome: "extracted", batchId, itemCount: result.items.length, truncated: result.truncated };
}

/**
 * CANVAS-GAP-02 — the token-connected counterpart to `extractSyllabusDeliverables`
 * above: SAME extraction pipeline and staging outcome shape, sourced from
 * Canvas's own `syllabus_body` instead of an uploaded PDF. An ADDITIONAL
 * path, never a replacement -- `extractSyllabusDeliverables` above is
 * completely unaffected and still the only option for a class with no
 * Canvas link, or whose Canvas syllabus is empty/unhelpful.
 */
export type CanvasSyllabusImportActionOutcome =
  | CanvasSyllabusImportOutcome
  | { outcome: "not_connected" }
  | { outcome: "not_mapped" }
  | { outcome: "fetch_failed"; message: string };

export async function importCanvasSyllabus(classId: string): Promise<CanvasSyllabusImportActionOutcome> {
  const { supabase, userId } = await requireUser();

  let conn: Awaited<ReturnType<typeof resolveCanvasConnectionCore>>;
  try {
    conn = await resolveCanvasConnectionCore(supabase, userId);
  } catch {
    return { outcome: "not_connected" };
  }
  if (!conn) return { outcome: "not_connected" };

  const { data: mapping } = await supabase.from("canvas_course_mappings").select("canvas_course_id").eq("user_id", userId).eq("class_id", classId).maybeSingle();
  if (!mapping) return { outcome: "not_mapped" };

  let syllabusRes: Awaited<ReturnType<typeof fetchCanvasCourseSyllabus>>;
  try {
    syllabusRes = await fetchCanvasCourseSyllabus(conn.instanceUrl, conn.token, mapping.canvas_course_id);
  } catch (err) {
    return { outcome: "fetch_failed", message: err instanceof Error ? err.message : "Couldn't fetch the syllabus. Try again." };
  }
  if (!syllabusRes.ok) return { outcome: "fetch_failed", message: syllabusRes.message };

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const result = await importCanvasSyllabusCore(supabase, userId, classId, timezone, new Date(), syllabusRes.data);
  if (result.outcome === "extracted") revalidatePath("/school");
  return result;
}
