import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayChat } from "@/lib/ai/gateway";
import {
  RawResponseSchema,
  stripCodeFence,
  normalizeDraft,
  type QuestionDraft,
} from "./question-draft-generation";

/**
 * P3-16 — the third input source for AI question drafting (after manual
 * entry and pasted-notes drafting, Phase 1 #23). Reuses that pipeline's own
 * schema, response parsing, and normalization (question-draft-generation.ts,
 * exported for this file) rather than redefining an equivalent contract —
 * one question-draft response shape for every input source. Calls
 * `gatewayChat` exactly like the notes path does, so it automatically gets
 * the same tiering, retry, and BOTH spend caps (the shared-key lifetime cap
 * and the user's own monthly cap, lib/ai/monthly-spend-cap.ts) for free —
 * no separate pre-flight check needed here, unlike P3-15's transcription
 * (which calls OpenAI/Gemini directly, outside the gateway).
 *
 * CHUNKED (a9's explicit ask): a lecture transcript is routinely far longer
 * than a pasted-notes paste. Split into MAX_CHUNK_CHARS pieces (the SAME
 * size question-draft-generation.ts's own MAX_NOTES_CHARS uses — one
 * chunk is exactly one notes-sized call), drafted SEQUENTIALLY, never in
 * parallel: a monthly-cap check that would correctly block chunk 3 could
 * race past if chunks fired concurrently, the same class of hazard
 * P3-15's transcription-spend gate was built to avoid. Capped at
 * MAX_CHUNKS_PER_TRANSCRIPT calls per transcript (a hard ceiling on spend
 * for a pathologically long transcript) and MAX_TOTAL_DRAFTS drafts across
 * every chunk combined (more than a notes paste's own 20-per-call cap,
 * since a full lecture has more real content, but still bounded — never
 * unbounded output for unbounded cost).
 */

const MAX_CHUNK_CHARS = 20_000; // matches question-draft-generation.ts's MAX_NOTES_CHARS
const MAX_CHUNKS_PER_TRANSCRIPT = 6; // ~120k chars of transcript, well past a realistic lecture
const MAX_TOTAL_DRAFTS = 30;

export type TranscriptQuestionDraftOutcome =
  | { status: "drafted"; drafts: QuestionDraft[]; partial: boolean }
  | { status: "no_key" }
  | { status: "unavailable" }
  | { status: "parse_failed" };

const SYSTEM_PROMPT = `You write retrieval-practice question/answer pairs from a segment of a lecture transcript, for spaced-repetition review (the generation effect: recalling from memory, not re-reading).

This is ONE PART of a longer transcript -- draft only from what's in THIS part; don't reference "earlier" or "later" in the lecture.

Return ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "prompt": string (a question testing ONE specific fact or idea from this transcript segment),
  "answer": string (the correct, concise answer),
  "topic": a short topic label (e.g. "Photosynthesis"), or null,
  "sourceSnippet": a short verbatim quote from this segment this came from, or null
}

Write at most 20 questions. Prefer fewer, well-targeted questions over many
shallow or overlapping ones. Each question must be answerable FROM THIS
TRANSCRIPT SEGMENT ALONE -- never invent facts it doesn't contain. Spoken
lecture transcripts often contain filler, tangents, and Q&A asides with no
real content -- if this segment has nothing worth quizzing, return [].`;

/** Splits on the last whitespace before the limit when one exists, so a
 * chunk boundary doesn't routinely land mid-word -- cosmetic for the model
 * (it can handle a cut word fine) but a cleaner `sourceSnippet` candidate
 * for the reviewer. Falls back to a hard cut for a single unbroken run
 * longer than the limit (pathological, but never allowed to loop forever). */
function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      chunks.push(rest);
      break;
    }
    const window = rest.slice(0, maxChars);
    const lastSpace = window.lastIndexOf(" ");
    const cut = lastSpace > maxChars * 0.5 ? lastSpace : maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return chunks;
}

function parseDraftResponse(content: string): QuestionDraft[] | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripCodeFence(content));
  } catch {
    return null;
  }
  const validated = RawResponseSchema.safeParse(parsedJson);
  if (!validated.success) return null;
  return validated.data.map(normalizeDraft);
}

export async function draftQuestionsFromTranscript(
  supabase: SupabaseClient,
  userId: string,
  transcriptText: string,
): Promise<TranscriptQuestionDraftOutcome> {
  const chunks = chunkText(transcriptText, MAX_CHUNK_CHARS).slice(0, MAX_CHUNKS_PER_TRANSCRIPT);
  if (chunks.length === 0) return { status: "parse_failed" };

  const drafts: QuestionDraft[] = [];
  let anyChunkSucceeded = false;
  let anyChunkParseFailed = false;
  let chunksProcessed = 0;

  for (const chunk of chunks) {
    if (drafts.length >= MAX_TOTAL_DRAFTS) break; // hit the total cap -- the remaining chunks are never sent, `partial` reflects that below

    // Sequential, never Promise.all -- see this file's own header for why.
    const result = await gatewayChat(
      supabase,
      userId,
      "school-question-draft-transcript",
      [
        { role: "system", content: SYSTEM_PROMPT },
        // Untrusted input, never an instruction -- same tagging discipline
        // as question-draft-generation.ts's <notes>.
        { role: "user", content: `<transcript_segment>\n${chunk}\n</transcript_segment>` },
      ],
      { maxTokens: 2000, timeoutMs: 30_000 },
    );
    chunksProcessed++;

    if (!result.ok) {
      // No key at all -- true for every chunk alike, stop immediately
      // rather than repeating the same failure MAX_CHUNKS_PER_TRANSCRIPT
      // times. Same discriminating condition question-draft-generation.ts's
      // own draftQuestionsFromNotes already uses.
      if (result.attempts === undefined && !result.monthlyCapBlocked) {
        if (!anyChunkSucceeded) return { status: "no_key" };
        break;
      }
      // A cap refusal or a genuine provider failure on this chunk -- stop
      // processing further chunks (retrying won't help a cap refusal, and a
      // provider outage likely affects the next chunk too), but keep
      // whatever earlier chunks already produced.
      break;
    }

    if (!result.content) {
      anyChunkParseFailed = true;
      continue;
    }
    const chunkDrafts = parseDraftResponse(result.content);
    if (chunkDrafts === null) {
      anyChunkParseFailed = true;
      continue;
    }
    anyChunkSucceeded = true;
    drafts.push(...chunkDrafts);
  }

  // "partial" means the caller should know this ISN'T the transcript's full
  // question set -- either because a later chunk was never even attempted
  // (a failure/cap stopped the loop early, or the total-draft cap was hit),
  // never because a chunk legitimately drafted zero questions (that's a
  // normal, complete result for that chunk).
  const partial = chunksProcessed < chunks.length;

  if (drafts.length > 0) {
    return { status: "drafted", drafts: drafts.slice(0, MAX_TOTAL_DRAFTS), partial };
  }
  if (anyChunkParseFailed && !anyChunkSucceeded) return { status: "parse_failed" };
  return { status: "unavailable" };
}

/** The transcript pieces an agent job is made of: the same chunks the in-app drafting would send, at most MAX_CHUNKS_PER_TRANSCRIPT, and whether the transcript was longer than that. */
export function transcriptChunksForQueue(transcriptText: string): { chunks: string[]; partial: boolean } {
  const all = chunkText(transcriptText, MAX_CHUNK_CHARS);
  return { chunks: all.slice(0, MAX_CHUNKS_PER_TRANSCRIPT), partial: all.length > MAX_CHUNKS_PER_TRANSCRIPT };
}
