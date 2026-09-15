import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayChat } from "@/lib/ai/gateway";
import { RawItemSchema, normalizeItem, stripCodeFence, type ExtractedItem, type ExtractionOutcome } from "./syllabus-extraction";

/**
 * P2-07 — pasted course announcement text -> staged deliverables. Reuses the
 * SAME staging pipeline as syllabus extraction (migration 167 was built with
 * `source in ('syllabus', 'announcement')` from the start -- see this task's
 * own Plan for the confirmation) and the SAME validation/normalization
 * (`RawItemSchema`/`normalizeItem`/`stripCodeFence`, exported from
 * syllabus-extraction.ts) -- only the system prompt differs, because an
 * announcement's phrasing genuinely differs from a syllabus's: it is short,
 * informal, and often describes a CHANGE to something already scheduled
 * ("moved to", "postponed", "cancelled") rather than a first listing.
 *
 * CALLS ONLY THROUGH `gatewayChat`, same rule as syllabus-extraction.ts's
 * own header.
 */

/** An announcement is expected to be short (an email, a Canvas post, a
 * paragraph) -- generous but far below the syllabus bound (20,000), so a
 * pasted multi-page document doesn't quietly become an expensive call. */
const MAX_ANNOUNCEMENT_CHARS = 4_000;

const RawResponseSchema = z.array(RawItemSchema).max(200);

const SYSTEM_PROMPT = `You extract graded-deliverable updates from a short course announcement (an email, a Canvas post, or similar).

Return ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "name": string (e.g. "Midterm Exam 1"),
  "type": one of "quiz" | "exam" | "final_midterm" | "homework_assignment" | "project_paper",
  "date": "YYYY-MM-DD" or null,
  "confidence": number from 0 to 1,
  "sourceSnippet": a short verbatim quote from the text this came from, or null
}

The announcement may describe a NEW deliverable, or a CHANGE to one that already exists
(rescheduled, moved, postponed, added, cancelled) -- in every case, return the item as it
stands AFTER the announcement (the new/final date), never the original one being replaced.
A cancelled item should still be returned if it names a specific graded deliverable, so the
person reviewing can decide what to do with it; do not silently omit it.

CRITICAL: if you are not confident of an exact date, set "date" to null. Do not guess a date
from a vague or relative reference ("next week", "before break", "TBD") — null is correct and
expected for those. If the announcement mentions no graded deliverables at all (a reminder
about office hours, a general update), return [].`;

export async function extractDeliverablesFromAnnouncementText(
  supabase: SupabaseClient,
  userId: string,
  announcementText: string,
  todayStr: string
): Promise<ExtractionOutcome> {
  const truncated = announcementText.length > MAX_ANNOUNCEMENT_CHARS;
  const bounded = truncated ? announcementText.slice(0, MAX_ANNOUNCEMENT_CHARS) : announcementText;

  const result = await gatewayChat(
    supabase,
    userId,
    "school-announcement-extraction",
    [
      { role: "system", content: SYSTEM_PROMPT },
      // Untrusted content, never an instruction -- same tag-wrapping posture
      // syllabus-extraction.ts's own call uses, for the same reason: an
      // announcement that happens to contain something instruction-shaped
      // must be read as content to extract FROM.
      { role: "user", content: `<announcement_text>\n${bounded}\n</announcement_text>` },
    ],
    { tier: "cheap", maxTokens: 1500, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    if (result.attempts === undefined && !result.capBlocked) return { status: "no_key" };
    return { status: "unavailable" };
  }

  if (!result.content) return { status: "parse_failed" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripCodeFence(result.content));
  } catch {
    return { status: "parse_failed" };
  }

  const validated = RawResponseSchema.safeParse(parsedJson);
  if (!validated.success) return { status: "parse_failed" };

  return { status: "extracted", items: validated.data.map((r: z.infer<typeof RawItemSchema>) => normalizeItem(r, todayStr)), truncated };
}

export type { ExtractedItem, ExtractionOutcome };
