import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GatewayLlmProvider,
  stripJsonFence,
  EXTRACT_LESSONS_SYSTEM_PROMPT,
  GENERATE_CARDS_SYSTEM_PROMPT,
  ENTAILMENT_SYSTEM_PROMPT,
} from "@/lib/self-mastery/ingestion/llm/gateway-provider";
import { classifyEvidenceStrength } from "@/lib/self-mastery/ingestion/evidence-strength";
import { applyExtractedLessons, applyGeneratedCards, applyEntailmentVerdict } from "@/lib/self-mastery/ingestion/stage-apply";
import type { CandidateLesson, EntailmentCheckResult, GeneratedCard } from "@/lib/self-mastery/ingestion/llm/types";
import { ApplyRejected } from "./apply-rejected";

/**
 * One model call of book ingestion, done by the owner's agent (kind self_mastery.book_stage, migration 281). The three stages are
 * extracting_lessons (one chunk), generating_cards (one lesson) and verifying_grounding (one lesson). This file is where an agent's result for ONE
 * such unit is validated with that stage's own parser and write-time gates (the same ones GatewayLlmProvider applies to a model's reply) and applied
 * through the same write functions the stage handlers use (stage-apply.ts), so what lands in the database is identical either way.
 *
 * The unit being worked on comes from the JOB's stored input, which the step route wrote from the database; the agent's result never names a chunk,
 * a lesson or a book. Applying is IDEMPOTENT per unit (delete-then-insert keyed by the chunk / lesson, or a guarded update), so a job applied twice
 * leaves the same rows. A result for a stage the pipeline has already left (a key was added mid-way, or the book was retried) is accepted and
 * applied to nothing ("stale").
 */

type StageInput = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function parseJson(value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(stripJsonFence(value)) };
  } catch {
    return { ok: false, message: "result is not valid JSON." };
  }
}

function lessonOf(input: StageInput): CandidateLesson {
  const l = (input.lesson ?? {}) as Record<string, unknown>;
  return {
    title: str(l.title),
    coreClaim: str(l.core_claim),
    mechanism: str(l.mechanism),
    actionTemplate: str(l.action_template),
    evidenceStrength: "author_anecdote",
    provenanceQuote: str(l.provenance_quote),
    pageRef: 0,
    sourceChunkId: "",
  };
}

export type ValidatedBookStage =
  | { ok: true; stage: "extracting_lessons"; candidates: CandidateLesson[] }
  | { ok: true; stage: "generating_cards"; cards: GeneratedCard[] }
  | { ok: true; stage: "verifying_grounding"; result: EntailmentCheckResult }
  | { ok: false; message: string };

const MAX_LESSONS_PER_CHUNK = 5;

/** The stage's own parser and gates, run on an agent's result. `message` says what to fix. */
export function validateBookStageResult(input: StageInput, rawResult: unknown): ValidatedBookStage {
  const json = parseJson(rawResult);
  if (!json.ok) return json;
  const result = json.value;
  const stage = str(input.stage);

  if (stage === "extracting_lessons") {
    const lessons = (result as { lessons?: unknown } | null)?.lessons;
    if (typeof result !== "object" || result === null || !Array.isArray(lessons)) {
      return { ok: false, message: 'result must be an object like {"lessons": [...]} ("lessons" is an array, empty when the passage has no extractable lesson).' };
    }
    const text = str(input.text);
    const { raw, passing } = GatewayLlmProvider.parseLessonCandidates(lessons, classifyEvidenceStrength(text), num(input.page_start), str(input.source_chunk_id), text);
    if (lessons.length > 0 && passing.length === 0) {
      return {
        ok: false,
        message:
          raw.length === 0
            ? "None of your lessons passed the checks: each needs title, core_claim, mechanism, action_template and provenance_quote as strings, the provenance_quote copied verbatim from untrusted_input.text (same words, order and punctuation), everything in English."
            : "None of your lessons passed the checks: each core_claim must restate its provenance_quote in clearly DIFFERENT words and sentence structure (not a copy), and its title must be about the same point as the claim.",
      };
    }
    return { ok: true, stage, candidates: passing.slice(0, MAX_LESSONS_PER_CHUNK) };
  }

  if (stage === "generating_cards") {
    const o = (result ?? {}) as Record<string, unknown>;
    for (const field of ["free_recall_prompt", "application_prompt", "application_answer", "why_prompt"]) {
      if (typeof o[field] !== "string" || !(o[field] as string).trim()) return { ok: false, message: `result.${field} is required and must be a non-empty string.` };
    }
    const lesson = lessonOf(input);
    const { passing } = GatewayLlmProvider.buildCardCandidates(o as Record<string, string>, lesson);
    // The same guarantee the in-app path gives: a free_recall card always exists (the heuristic fallback) and a cloze is appended.
    return { ok: true, stage, cards: GatewayLlmProvider.finalizeCards(passing, lesson) };
  }

  if (stage === "verifying_grounding") {
    const o = (result ?? {}) as Record<string, unknown>;
    const verdict = o.verdict;
    if (verdict !== "SUPPORTS" && verdict !== "CONTRADICTS" && verdict !== "UNRELATED") return { ok: false, message: 'result.verdict must be "SUPPORTS", "CONTRADICTS" or "UNRELATED".' };
    return { ok: true, stage, result: { verdict, reason: typeof o.reason === "string" ? o.reason : "" } };
  }

  return { ok: false, message: "This step has an unknown stage." };
}

/** The exact JSON to submit, per stage. */
export function bookStageOutputSchema(input: StageInput): string {
  switch (str(input.stage)) {
    case "extracting_lessons":
      return '{"lessons": [{"title": "...", "core_claim": "...", "mechanism": "...", "action_template": "...", "provenance_quote": "..."}]}  (at most 2 lessons; an empty array when the passage has no extractable lesson; provenance_quote copied verbatim from untrusted_input.text)';
    case "generating_cards":
      return '{"free_recall_prompt": "...", "application_prompt": "...", "application_answer": "...", "why_prompt": "..."}';
    default:
      return '{"passage_point": "<one short sentence>", "verdict": "SUPPORTS" | "CONTRADICTS" | "UNRELATED", "reason": "<one short sentence>"}';
  }
}

/** What the agent is asked to do for this step: the in-app prompt's own rules, with the book text left in untrusted_input (never pasted into the instructions). */
export function bookStageInstructions(input: StageInput): string {
  switch (str(input.stage)) {
    case "extracting_lessons":
      return `${EXTRACT_LESSONS_SYSTEM_PROMPT}\n\n${GatewayLlmProvider.extractLessonsUserPrompt({
        chunkText: "(the passage is in untrusted_input.text)",
        pageStart: num(input.page_start),
        pageEnd: num(input.page_end),
        locationLabel: str(input.location) || undefined,
        sourceChunkId: "",
      })}`;
    case "generating_cards":
      return `${GENERATE_CARDS_SYSTEM_PROMPT}\n\n${GatewayLlmProvider.generateCardsUserPrompt({
        title: "(untrusted_input.lesson.title)",
        coreClaim: "(untrusted_input.lesson.core_claim)",
        mechanism: "(untrusted_input.lesson.mechanism)",
        actionTemplate: "(untrusted_input.lesson.action_template)",
        evidenceStrength: "author_anecdote",
        provenanceQuote: "",
        pageRef: 0,
        sourceChunkId: "",
      })}`;
    default:
      return `${ENTAILMENT_SYSTEM_PROMPT}\n\n${GatewayLlmProvider.entailmentUserPrompt({
        claim: "(untrusted_input.lesson.core_claim)",
        quote: "(untrusted_input.lesson.provenance_quote)",
      })}`;
  }
}

/**
 * Validates and applies one unit's result. `service` writes the stage's output tables (bypassing RLS exactly as the stage handlers do; every id comes
 * from the job); `user` is the caller's own client, used only to release the parked ingestion job. Returns what to keep as the job's result.
 */
export async function applyBookStageResult(
  service: SupabaseClient,
  user: SupabaseClient,
  userId: string,
  job: { id: string; subjectId: string | null; input: StageInput },
  rawResult: unknown,
): Promise<{ stored: Record<string, unknown>; summary: string }> {
  const bookId = job.subjectId;
  if (!bookId) throw new ApplyRejected("This step has no book to attach the result to.");
  const validated = validateBookStageResult(job.input, rawResult);
  if (!validated.ok) throw new ApplyRejected(validated.message);
  const stage = validated.stage;

  const { data: book, error: bookError } = await service.from("books").select("id").eq("id", bookId).eq("user_id", userId).maybeSingle();
  if (bookError) throw bookError;
  if (!book) throw new Error("book not found for this job's owner");

  // Stale: the pipeline is no longer in this stage (a key was added and the owner's own key finished it, or the book was retried).
  const { data: ingestion, error: ingestionError } = await service.from("ingestion_jobs").select("stage").eq("book_id", bookId).maybeSingle();
  if (ingestionError) throw ingestionError;
  const stale = (summary: string) => ({ stored: { stage, applied: false, stale: true }, summary });
  if ((ingestion as { stage?: string } | null)?.stage !== stage) return stale(`ignored a ${stage} result: the book has moved past that step`);

  if (validated.stage === "extracting_lessons") {
    const chunkId = str(job.input.source_chunk_id);
    const { data: chunk, error } = await service.from("source_chunks").select("id, section_id").eq("id", chunkId).eq("book_id", bookId).maybeSingle();
    if (error) throw error;
    if (!chunk) return stale("ignored a result for a passage that no longer exists");
    await applyExtractedLessons(service, {
      bookId,
      chunk: { id: chunk.id as string, sectionId: (chunk.section_id as string | null) ?? null },
      candidates: validated.candidates,
      paged: job.input.paged !== false,
    });
  } else {
    const lessonId = str(job.input.lesson_id);
    const { data: lesson, error } = await service.from("lessons").select("id, rank").eq("id", lessonId).eq("book_id", bookId).maybeSingle();
    if (error) throw error;
    if (!lesson || (lesson as { rank: number | null }).rank === null) return stale("ignored a result for a lesson that is no longer selected");
    if (validated.stage === "generating_cards") {
      await applyGeneratedCards(service, { userId, bookId, lessonId, cards: validated.cards });
    } else {
      await applyEntailmentVerdict(service, { lessonId, result: validated.result });
    }
  }

  // A result has landed: let the pipeline continue (it re-plans, slides the window, and moves on when the stage is complete).
  await user.rpc("unpark_ingestion_for_book", { p_book_id: bookId });
  return { stored: { stage, applied: true }, summary: `applied a ${stage} step` };
}
