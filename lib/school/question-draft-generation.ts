import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayChat } from "@/lib/ai/gateway";
import { describeZodIssues } from "@/lib/ai/zod-issues";

/**
 * Phase 1 #23 — pasted notes -> AI-drafted retrieval-practice questions.
 * Pure extraction/validation, same split as syllabus-extraction.ts (#16):
 * nothing here touches the database — question-draft-actions.ts wires the
 * requireUser()/persistence side, and every draft is reviewed and edited
 * by the user (question-bank-panel.tsx) before `createQuestion` ever
 * writes a real row with `origin: "ai"`.
 *
 * CALLS ONLY THROUGH `gatewayChat` — never a provider client directly, same
 * rule as every other AI-backed feature in this codebase.
 *
 * TIER/PROVIDER: both OMITTED (Opus Lead ruling for this call site,
 * explicitly different from syllabus-extraction.ts's own `tier: "cheap"`
 * override) — gatewayChat resolves the CALLER's own saved AI preference
 * (provider + tier) when both are omitted (gateway.ts's own 2026-09-15
 * reversal). Syllabus extraction forces "cheap" because it runs against an
 * uploaded institutional document the user didn't choose to spend on;
 * drafting questions from a user's own pasted notes, on demand, at their
 * own request, is exactly the kind of call the Lead's ruling says should
 * ride whatever tier the user is already paying for — forcing "cheap" here
 * would silently downgrade a user who picked a "capable" tier.
 */

/** Generous for a real set of lecture/reading notes without inviting a
 * runaway prompt from an accidentally-pasted huge document. Mirrors
 * syllabus-extraction.ts's own MAX_SYLLABUS_CHARS value and reasoning —
 * the caller is told when this truncates. */
const MAX_NOTES_CHARS = 20_000;

export interface QuestionDraft {
  prompt: string;
  answer: string;
  topic: string | null;
  /** A short verbatim quote from the pasted notes this came from, or null
   * when the model didn't supply one. Pre-fills the review form's own
   * source-anchor field (question-bank-panel.tsx) — still fully editable,
   * still subject to the same required-or-skip rule every question goes
   * through, never inserted directly. */
  sourceSnippet: string | null;
}

export type QuestionDraftOutcome =
  | { status: "drafted"; drafts: QuestionDraft[]; truncated: boolean }
  /** No usable key for this account at all — actionable, not a failure
   * (same posture as syllabus extraction's own `no_key`): "add a key to
   * draft automatically" is a real next step, manual entry still works. */
  | { status: "no_key" }
  /** A key existed and a real attempt was made (cap refusal, timeout,
   * provider error) — distinct from `no_key` since "add a key" would be
   * false advice to someone who already has one. */
  | { status: "unavailable" }
  /** The gateway call succeeded but the response wasn't valid JSON matching
   * the schema below — never crashes the caller, degrades to "nothing
   * drafted," the same as syllabus extraction's own `parse_failed`. */
  | { status: "parse_failed" };

// Exported (P3-16): lib/school/question-draft-from-transcript.ts reuses this
// exact schema/shape rather than redefining an equivalent one -- one
// question-draft response contract for both input sources.
export const RawDraftSchema = z.object({
  prompt: z.string().min(1).max(500),
  answer: z.string().min(1).max(2000),
  topic: z.string().max(100).nullable().optional(),
  sourceSnippet: z.string().max(300).nullable().optional(),
});
// At most 20 per call (also instructed in the system prompt) -- a casual
// notes paste is a lecture or a reading, not a textbook; unbounded output
// here would be an unbounded cost per click.
export const RawResponseSchema = z.array(RawDraftSchema).max(20);

const SYSTEM_PROMPT = `You write retrieval-practice question/answer pairs from a student's own notes, for spaced-repetition review (the generation effect: recalling from memory, not re-reading).

Return ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "prompt": string (a question testing ONE specific fact or idea from the notes),
  "answer": string (the correct, concise answer),
  "topic": a short topic label (e.g. "Photosynthesis"), or null,
  "sourceSnippet": a short verbatim quote from the notes this came from, or null
}

Write at most 20 questions. Prefer fewer, well-targeted questions over many
shallow or overlapping ones. Each question must be answerable FROM THE NOTES
ALONE — never invent facts the notes don't contain. If the notes contain no
material worth quizzing (e.g. they're empty, or pure logistics with no
content), return [].`;

/** Same tolerance as syllabus-extraction.ts's own stripCodeFence — a
 * response-shape allowance, not a provider-specific quirk. Exported (P3-16)
 * for reuse by question-draft-from-transcript.ts. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/** Exported (P3-16) for reuse by question-draft-from-transcript.ts. */
export function normalizeDraft(raw: z.infer<typeof RawDraftSchema>): QuestionDraft {
  return {
    prompt: raw.prompt.trim(),
    answer: raw.answer.trim(),
    topic: raw.topic?.trim() || null,
    sourceSnippet: raw.sourceSnippet?.trim() || null,
  };
}

export type ValidatedDrafts = { ok: true; drafts: QuestionDraft[] } | { ok: false; message: string };

/** The gate for "a model (or an agent) produced question drafts" (array, or the same as a JSON string). Used by agent-job submits (lib/agent-jobs); `message` names the offending field. */
export function validateQuestionDrafts(value: unknown): ValidatedDrafts {
  let parsedJson = value;
  if (typeof value === "string") {
    try {
      parsedJson = JSON.parse(stripCodeFence(value));
    } catch {
      return { ok: false, message: "result is not valid JSON." };
    }
  }
  const validated = RawResponseSchema.safeParse(parsedJson);
  if (!validated.success) return { ok: false, message: describeZodIssues(validated.error) };
  return { ok: true, drafts: validated.data.map(normalizeDraft) };
}

export async function draftQuestionsFromNotes(
  supabase: SupabaseClient,
  userId: string,
  notesText: string
): Promise<QuestionDraftOutcome> {
  const truncated = notesText.length > MAX_NOTES_CHARS;
  const bounded = truncated ? notesText.slice(0, MAX_NOTES_CHARS) : notesText;

  const result = await gatewayChat(
    supabase,
    userId,
    "school-question-draft",
    [
      { role: "system", content: SYSTEM_PROMPT },
      // Untrusted input, never an instruction -- same tagging discipline as
      // syllabus-extraction.ts's <syllabus_text>: notes that happen to
      // contain something instruction-shaped are read as content to draft
      // FROM, not a new instruction. The user reviews every draft before
      // anything lands regardless.
      { role: "user", content: `<notes>\n${bounded}\n</notes>` },
    ],
    { maxTokens: 2000, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    // Same distinguishing logic as syllabus-extraction.ts: `attempts` is
    // absent exactly when no call was attempted at all (no key, or a cap
    // refusal before any provider was reached).
    if (result.attempts === undefined) return { status: "no_key" };
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

  return { status: "drafted", drafts: validated.data.map(normalizeDraft), truncated };
}
