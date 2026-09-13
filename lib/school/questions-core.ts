import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-course question CRUD (Phase 1 #20/#21/#22). `public.questions`
 * (migration 111, folded in from the withdrawn `095_school_questions.sql`)
 * has existed live since before this session -- correct columns, RLS
 * (`questions_own_row`), the `origin` CHECK (`self`|`ai`|`missed`) -- and
 * was confirmed empty with zero application-code callers (this engineer's
 * own recon: no `.from("questions")` call anywhere in this repository).
 * This file is that first write path.
 *
 * R5 core(supabase, userId, ...) extraction, same discipline as
 * lib/school/actions-core.ts and every other *-core.ts in this program:
 * no requireUser()/getProfile()/getAuthedUser() in here, so this is
 * directly unit-testable against a mocked client with no cookie coupling.
 *
 * NOT EXTRACTED HERE, DELIBERATELY, mirroring actions-core.ts's own header:
 * - There is no hard-DELETE function. Migration 111's own comment on
 *   `questions.active` is explicit: "Retired rather than deleted: reviews
 *   reference questions, and deleting a question would silently rewrite
 *   the user's own history of what they practised... there is no
 *   delete-a-question affordance." `setQuestionActiveCore` (false) is the
 *   one and only removal action, and it is reversible.
 * - MCP write registration: NOT added in this pass. `questions` is already
 *   READ-registered under `self_mastery` (lib/mcp/registry.ts, ~line 1046)
 *   but `lib/mcp/write-registry.ts` is outside this engineer's owned
 *   directories, and — separately from ownership — whether an MCP-connected
 *   agent should be able to write into a user's own question bank
 *   autonomously is a product/security decision this file does not make
 *   unilaterally, the same posture actions-core.ts documents for syllabus
 *   upload (docs/ai-connector/SCHOOL-WRITE-SCOPE-DECISIONS.md). Flagged to
 *   the lead rather than defaulted either way.
 */

export type QuestionOrigin = "self" | "ai" | "missed";

export interface QuestionRow {
  id: string;
  classId: string;
  prompt: string;
  answer: string;
  topic: string | null;
  sourceAnchor: string | null;
  sourceSkipped: boolean;
  origin: QuestionOrigin;
  active: boolean;
}

export interface CreateQuestionInput {
  classId: string;
  prompt: string;
  answer: string;
  topic?: string | null;
  sourceAnchor?: string | null;
  sourceSkipped?: boolean;
  /** Defaults to "self" (the user wrote it) -- #22's manual-entry path.
   * #23 (AI-drafted) would pass "ai" once the LLM gateway exists; nothing
   * in this codebase does yet. */
  origin?: QuestionOrigin;
}

export interface CreateQuestionResult {
  id: string;
}

/**
 * The anchor invariant (`questions_anchor_present_or_skipped`) is enforced
 * here too, not only trusted to the DB CHECK -- a bad submission fails
 * before a network round-trip, the same discipline class-assessments.tsx
 * already applies to weight_pct client-side. Trims every text field before
 * it reaches the database; an all-whitespace prompt/answer is rejected the
 * same as an empty one (mirrors the DB's own `length(btrim(...)) > 0`
 * checks, so a mismatch between what the client allows and what the
 * database allows can never surface as a confusing late failure).
 */
export async function createQuestionCore(
  supabase: SupabaseClient,
  userId: string,
  input: CreateQuestionInput
): Promise<CreateQuestionResult> {
  const prompt = input.prompt.trim();
  const answer = input.answer.trim();
  if (!prompt) throw new Error("Prompt is required");
  if (!answer) throw new Error("Answer is required");

  const sourceSkipped = input.sourceSkipped ?? false;
  const sourceAnchor = input.sourceAnchor?.trim() || null;
  if (!sourceSkipped && !sourceAnchor) {
    throw new Error("Provide a source anchor, or mark it skipped");
  }

  const { data, error } = await supabase
    .from("questions")
    .insert({
      user_id: userId,
      class_id: input.classId,
      prompt,
      answer,
      topic: input.topic?.trim() || null,
      // The anchor invariant again, at the write itself: a skipped anchor
      // never carries stale/leftover anchor text into storage.
      source_anchor: sourceSkipped ? null : sourceAnchor,
      source_skipped: sourceSkipped,
      origin: input.origin ?? "self",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export interface UpdateQuestionInput {
  prompt?: string;
  answer?: string;
  topic?: string | null;
  sourceAnchor?: string | null;
  sourceSkipped?: boolean;
}

/**
 * Partial patch, field-by-field like updateClassAssessmentCore -- a field
 * left `undefined` (omitted) is untouched, never coalesced to null or
 * dropped silently. sourceAnchor/sourceSkipped are NOT cross-validated
 * against each other here the way createQuestionCore validates them
 * together: an update patching only one of the pair mid-edit is a normal,
 * transient shape (the caller's own form state enforces the full invariant
 * before submitting the WHOLE edit), and the database's own
 * `questions_anchor_present_or_skipped` CHECK is still the final word --
 * an update that would leave the row in an illegal combined state is
 * rejected there, not silently allowed here.
 */
export async function updateQuestionCore(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  input: UpdateQuestionInput
): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (input.prompt !== undefined) {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required");
    patch.prompt = prompt;
  }
  if (input.answer !== undefined) {
    const answer = input.answer.trim();
    if (!answer) throw new Error("Answer is required");
    patch.answer = answer;
  }
  if (input.topic !== undefined) patch.topic = input.topic?.trim() || null;
  if (input.sourceAnchor !== undefined) patch.source_anchor = input.sourceAnchor?.trim() || null;
  if (input.sourceSkipped !== undefined) patch.source_skipped = input.sourceSkipped;

  const { error } = await supabase.from("questions").update(patch).eq("id", questionId).eq("user_id", userId);
  if (error) throw error;
}

/**
 * The ONLY state-removal action for a question, by design (see this file's
 * own header) -- never a hard DELETE. Reversible: calling this with
 * `active: true` on a retired question brings it back, same primitive
 * either direction.
 */
export async function setQuestionActiveCore(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  active: boolean
): Promise<void> {
  const { error } = await supabase.from("questions").update({ active }).eq("id", questionId).eq("user_id", userId);
  if (error) throw error;
}
