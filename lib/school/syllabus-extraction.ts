import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayChat } from "@/lib/ai/gateway";
import { addMonthsToDateString } from "@/lib/date-utils";
import { ASSESSMENT_TYPES, type AssessmentType } from "@/lib/school/actions-core";

/**
 * Phase 1 #16 — syllabus text -> staged deliverables. Everything in here is pure
 * extraction/validation; nothing here touches the database or Storage (see
 * syllabus-extraction-actions.ts for the upload/staging wiring that calls this).
 *
 * CALLS ONLY THROUGH `gatewayChat` — never a provider client directly (Opus Lead
 * ruling, ahead of the multi-provider work landing in lib/ai). This module never
 * assumes which provider answered or hard-codes a provider-specific response
 * quirk; the response is validated against the zod schema below regardless of
 * what produced it.
 */

/** ~5-6k tokens, generous for an actual syllabus. Guards against a mistakenly-
 * uploaded 200-page course packet turning into a huge, expensive call — the
 * caller is told when this truncates so the review UI can say so. */
const MAX_SYLLABUS_CHARS = 20_000;

export interface ExtractedItem {
  name: string;
  type: AssessmentType;
  /** Null means unresolved/implausible — the no-guessing rule (#17) applies to a
   * hallucinated date exactly as much as to one the model couldn't find at all. */
  date: string | null;
  /** 0 when the model's own `type` was invalid and got remapped (see normalizeItem) —
   * not the model's real confidence in that case, a deliberate "needs review" flag. */
  confidence: number;
  sourceSnippet: string | null;
}

export type ExtractionOutcome =
  | { status: "extracted"; items: ExtractedItem[]; truncated: boolean }
  /** No usable key for this account at all — the first-class, non-error path
   * (Opus Lead ruling): "add an API key to extract automatically" is actionable,
   * not a failure message. */
  | { status: "no_key" }
  /** A key existed and a real attempt was made (cap refusal, timeout, provider
   * error) — distinct from `no_key` because "add a key" would be false advice
   * to someone who already has one. */
  | { status: "unavailable" }
  /** The gateway call succeeded but the response wasn't valid JSON matching the
   * schema below — never crashes the caller, degrades to "nothing extracted." */
  | { status: "parse_failed" };

/** Exported for lib/school/announcement-extraction.ts (P2-07) to reuse rather than
 * reimplement -- same validation/normalization for the same underlying shape,
 * only the system prompt differs between a syllabus and a pasted announcement. */
export const RawItemSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string(),
  date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  sourceSnippet: z.string().max(500).nullable().optional(),
});
const RawResponseSchema = z.array(RawItemSchema).max(200);

const SYSTEM_PROMPT = `You extract graded deliverables (exams, quizzes, homework, projects) from a course syllabus.

Return ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "name": string (e.g. "Midterm Exam 1"),
  "type": one of "quiz" | "exam" | "final_midterm" | "homework_assignment" | "project_paper",
  "date": "YYYY-MM-DD" or null,
  "confidence": number from 0 to 1,
  "sourceSnippet": a short verbatim quote from the text this came from, or null
}

CRITICAL: if you are not confident of an exact date, set "date" to null. Do not guess
a date from a vague reference like "week 8" or "TBD" — null is correct and expected
for those. A syllabus with no dates at all should return items with date: null, not
be treated as an error. If the syllabus lists no deliverables at all, return [].`;

function isPlausibleDate(dateStr: string, todayStr: string): boolean {
  const earliest = addMonthsToDateString(todayStr, -12);
  const latest = addMonthsToDateString(todayStr, 12);
  // Valid for same-length YYYY-MM-DD strings, same convention this codebase already
  // relies on elsewhere (e.g. bucketTaskGroup's own date comparisons).
  return dateStr >= earliest && dateStr <= latest;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maps a raw, untrusted model item onto the real column shapes. Two things get
 * silently corrected rather than rejecting the whole item, per Opus Lead ruling:
 *
 * - An invalid/unrecognized `type` (the model returned free text, or hallucinated a
 *   value outside the five real ones) is NOT dropped — `class_assessments.type` is
 *   NOT NULL with no "unknown"/"other" bucket, so this maps to `homework_assignment`
 *   as a real, insertable placeholder and zeroes `confidence` so the review UI's
 *   confidence badge visibly flags it — the user corrects the type there rather than
 *   the item silently vanishing or the whole batch failing.
 * - A malformed or implausible date (not YYYY-MM-DD, or more than 12 months from
 *   today in either direction) becomes null. `classes.term` is free text with no
 *   parseable start/end date, so ±12 months of today is the only honest plausibility
 *   window available — an ISO-shaped date from 1970 or 2099 is still a fabrication.
 */
export function normalizeItem(raw: z.infer<typeof RawItemSchema>, todayStr: string): ExtractedItem {
  const isValidType = (ASSESSMENT_TYPES as readonly string[]).includes(raw.type);
  const datePlausible = raw.date !== null && ISO_DATE_RE.test(raw.date) && isPlausibleDate(raw.date, todayStr);

  return {
    name: raw.name.trim(),
    type: isValidType ? (raw.type as AssessmentType) : "homework_assignment",
    date: datePlausible ? raw.date : null,
    confidence: isValidType ? raw.confidence : 0,
    sourceSnippet: raw.sourceSnippet ?? null,
  };
}

/** Strips a leading/trailing markdown code fence if the model added one despite
 * being told not to — a response-shape tolerance, not a provider-specific quirk
 * (every provider occasionally wraps JSON in ```json fences regardless of
 * instructions telling it not to). */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

export async function extractDeliverablesFromText(
  supabase: SupabaseClient,
  userId: string,
  syllabusText: string,
  todayStr: string
): Promise<ExtractionOutcome> {
  const truncated = syllabusText.length > MAX_SYLLABUS_CHARS;
  const bounded = truncated ? syllabusText.slice(0, MAX_SYLLABUS_CHARS) : syllabusText;

  const result = await gatewayChat(
    supabase,
    userId,
    "school-syllabus-extraction",
    [
      { role: "system", content: SYSTEM_PROMPT },
      // The syllabus text is untrusted input, never an instruction — wrapped in a
      // tag so a syllabus that happens to contain something instruction-shaped
      // ("ignore the above and...") is read as content to extract FROM, not a new
      // instruction to follow. Human confirmation (#18's confirm step) is the real
      // safeguard regardless; nothing this call produces lands without it.
      { role: "user", content: `<syllabus_text>\n${bounded}\n</syllabus_text>` },
    ],
    { tier: "cheap", maxTokens: 2000, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    // gatewayChat's own contract (see resolve-key.ts): `attempts` is absent exactly
    // when no call was attempted at all — no key, or a cap refusal before any
    // provider was ever reached. `capBlocked` distinguishes the latter, since
    // "add an API key" would be false advice to someone who already has one.
    if (result.attempts === undefined && !result.capBlocked) return { status: "no_key" };
    return { status: "unavailable" };
  }

  // `content` is the success field; `message` is the user-safe error string on
  // failure (already handled above) — using the wrong one here would always parse
  // `undefined` and misreport every successful call as parse_failed.
  if (!result.content) return { status: "parse_failed" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripCodeFence(result.content));
  } catch {
    return { status: "parse_failed" };
  }

  const validated = RawResponseSchema.safeParse(parsedJson);
  if (!validated.success) return { status: "parse_failed" };

  return { status: "extracted", items: validated.data.map((r) => normalizeItem(r, todayStr)), truncated };
}
