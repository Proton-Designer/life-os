/**
 * A5 item 7b/7 (item 7's stage-handler build): an LlmProvider backed by the
 * tools-disabled dev shim (A5 gate 1, scripts/dev-provider-shim.mjs).
 * `checkEntailment` was 7b's original scope. `extractLessons` and
 * `generateCards` were added for item 7 (the real-book run) — the prompts
 * are ported near-verbatim from `ollama-provider.ts`'s own (already
 * measured-against-real-books) versions, adapted from Ollama's raw
 * `format:"json"` completion to this shim's tool-forced JSON-schema shape.
 * `triageChunk`, `mergeLessons`, and `gradeAnswer` remain unimplemented —
 * triage stays heuristic everywhere (HeuristicProvider, free/zero-latency),
 * merging runs through HeuristicProvider's embedding-less degrade path (see
 * worker-stages.ts's `mergingStage`), and grading is out of item 7's scope.
 *
 * Speaks the wire shape the shim documents (08-DEV-PROVIDER-SCOPE.md /
 * dev-provider-shim.mjs): POST {model, messages, tools, tool_choice,
 * stream:false} to `${baseUrl}/chat/completions`, read
 * `choices[0].message.tool_calls[0].function.arguments` (a JSON string,
 * parsed here — the gateway-adapter scope doc is explicit that the gate is
 * a real parse of an object, never handing the string back raw).
 */
import type { EntailmentCheckInput, EntailmentCheckResult, LlmProvider, ChunkTriageInput, ChunkTriageResult, ExtractLessonsInput, CandidateLesson, MergeLessonsInput, GenerateCardsInput, GeneratedCard, GradeAnswerInput, GradeAnswerResult } from "./types";
import { getDevProviderBaseUrl } from "@/lib/ai/dev-provider";
import { isGrounded } from "./grounding";
import { classifyEvidenceStrength } from "../evidence-strength";
import { passesLanguageSanity, passesClaimNotQuote, passesAntiLeak, passesCardTextSanity } from "../invariants";
import { buildClozeCard, generateCardsForLesson } from "../cards";

const ENTAILMENT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["SUPPORTS", "CONTRADICTS", "UNRELATED"] },
    reason: { type: "string" },
  },
  required: ["verdict", "reason"],
} as const;

const ENTAILMENT_SYSTEM_PROMPT =
  "You are checking whether a source passage backs up a claim that was derived from it as a paraphrase or generalization. The claim is normally NOT a verbatim restatement of the passage. Only mark it down if the passage's actual point is a DIFFERENT specific idea than the claim, or the OPPOSITE of the claim.";

const EXTRACT_LESSONS_SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          core_claim: { type: "string" },
          mechanism: { type: "string" },
          action_template: { type: "string" },
          provenance_quote: { type: "string" },
        },
        required: ["title", "core_claim", "mechanism", "action_template", "provenance_quote"],
      },
    },
  },
  required: ["lessons"],
} as const;

const EXTRACT_LESSONS_SYSTEM_PROMPT =
  "You extract teachable lessons from book passages. Respond entirely in English regardless of the source language.";

const GENERATE_CARDS_SCHEMA = {
  type: "object",
  properties: {
    free_recall_prompt: { type: "string" },
    application_prompt: { type: "string" },
    application_answer: { type: "string" },
    why_prompt: { type: "string" },
  },
  required: ["free_recall_prompt", "application_prompt", "application_answer", "why_prompt"],
} as const;

const GENERATE_CARDS_SYSTEM_PROMPT =
  "You write retrieval-practice study questions from a lesson, without revealing the answer in the question.";

export interface DevShimUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
}

export class DevShimProvider implements LlmProvider {
  constructor(private readonly baseUrl: string, private readonly model = "claude-haiku-4-5-20251001") {}

  /** Throws if the dev provider isn't available in this environment — see
   * lib/ai/dev-provider.ts. Callers should check availability before
   * constructing this class; kept as a static factory so "no shim
   * configured" fails at the one obvious call site, not deep inside a
   * request. */
  static fromEnv(): DevShimProvider | null {
    const url = getDevProviderBaseUrl();
    return url ? new DevShimProvider(url) : null;
  }

  /** Set by the most recent checkEntailment call — read by the caller to
   * decide what to record in telemetry (0 tokens is impossible for a real
   * model call; this class never reports 0, unlike HeuristicProvider's
   * trivial path, which is exactly the honest distinction 7b asked for). */
  public lastUsage: DevShimUsage | null = null;

  /**
   * Shared low-level call: forces a single tool call against `toolName`,
   * records `lastUsage` from the response's real usage fields (never
   * defaulted to a non-zero guess), and returns the parsed JSON arguments
   * object UNVALIDATED — every caller below runs its own shape check
   * against its own expected fields, since "valid JSON" and "the JSON I
   * asked for" are different claims and only the caller knows which
   * fields matter for its own schema.
   */
  private async callTool(
    systemPrompt: string,
    userPrompt: string,
    toolName: string,
    schema: object,
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{ type: "function", function: { name: toolName, parameters: schema } }],
        tool_choice: { type: "function", function: { name: toolName } },
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`dev-shim-provider: ${toolName} failed (HTTP ${res.status}): ${body}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      total_cost_usd?: number;
    };
    const argsString = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsString) {
      throw new Error(`dev-shim-provider: ${toolName} got no tool_calls arguments in the response`);
    }

    this.lastUsage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      costUsd: json.total_cost_usd,
    };

    try {
      return JSON.parse(argsString);
    } catch {
      throw new Error(`dev-shim-provider: ${toolName}'s tool_calls arguments were not valid JSON: ${argsString.slice(0, 200)}`);
    }
  }

  async checkEntailment(input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    const prompt = `Claim: "${input.claim}"\n\nPassage: "${input.quote}"\n\nJudge whether the passage SUPPORTS, CONTRADICTS, or is UNRELATED to the claim.`;

    const parsed = await this.callTool(ENTAILMENT_SYSTEM_PROMPT, prompt, "entailment_verdict", ENTAILMENT_SCHEMA);

    const isEntailmentResult = (obj: unknown): obj is EntailmentCheckResult => {
      if (typeof obj !== "object" || obj === null) return false;
      const v = (obj as Record<string, unknown>)["verdict"];
      return v === "SUPPORTS" || v === "CONTRADICTS" || v === "UNRELATED";
    };
    if (!isEntailmentResult(parsed)) {
      // Fail closed, matching ollama-provider.ts's own checkEntailment
      // posture: an entailment check that didn't return a valid verdict is
      // exactly the situation this gate exists to catch, not a case to
      // silently trust.
      throw new Error(`dev-shim-provider: checkEntailment's parsed result is not a valid verdict shape: ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    return { verdict: parsed.verdict, reason: parsed.reason ?? "" };
  }

  /**
   * Ported from ollama-provider.ts's extractLessons prompt (already measured
   * against real books) — same rules text, same retry-with-strictness-note
   * shape, same write-time gates applied here (grounding, language sanity,
   * claim-not-quote). NOT applied here: `passesTitleClaimRelevance` (needs
   * an embedding this repo doesn't have — ADR-003) and the merge-time
   * claim/provenance cosine floor (`relevance_floor`, migration 117,
   * deferred for the same reason). `evidence_strength` is classified from
   * the chunk's own text, never the model's self-label — same reasoning as
   * the Ollama path.
   */
  async extractLessons(input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    const evidenceStrength = classifyEvidenceStrength(input.chunkText);
    const MAX_ATTEMPTS = 3;
    let bestCandidates: CandidateLesson[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's core_claim was rejected -- either it was too close to a copy of the quote (shared too much wording/structure), or its title drifted to a different topic than the claim itself. This time, express the claim in clearly different words and sentence structure, and make sure the title is about the SAME specific point as the claim, not just the same general subject.";
      const prompt = `Extract up to 2 distinct teachable lessons from this passage.

Rules:
- FIRST identify the ONE sentence (or short span) in the passage that the lesson is actually about. "provenance_quote" MUST be that exact span, copied verbatim (same words, same order, same punctuation) -- it is the specific sentence you are restating, not just any true/interesting sentence elsewhere in the passage. If you cannot point to the specific sentence a claim comes from, do not include that lesson.
- "core_claim" restates THAT SAME sentence's specific point in SUBSTANTIALLY DIFFERENT WORDS -- different vocabulary and sentence structure, not the quote with one or two words swapped. A claim that shares its structure or most of its phrasing with the quote will be rejected outright, even if it is otherwise accurate.
- "mechanism" must actually explain WHY the claim is true, staying on the same topic as the claim.
- "title" must be short and imperative where natural (e.g. "Use the two-minute rule", not "On starting"), AND must be about the exact same specific point as core_claim.
- "action_template" must be a specific, concrete action tied to this exact claim, not generic advice.
- If the passage has no extractable lesson, return an empty lessons array.${strictnessNote}

Passage (page ${input.pageStart}):
"""
${input.chunkText}
"""`;

      const parsed = await this.callTool(EXTRACT_LESSONS_SYSTEM_PROMPT, prompt, "extracted_lessons", EXTRACT_LESSONS_SCHEMA);
      const isValid = (obj: unknown): obj is { lessons: unknown[] } =>
        typeof obj === "object" && obj !== null && Array.isArray((obj as { lessons?: unknown }).lessons);
      if (!isValid(parsed)) continue;

      const rawCandidates: CandidateLesson[] = [];
      for (const raw of parsed.lessons) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        if (
          typeof r["title"] !== "string" ||
          typeof r["core_claim"] !== "string" ||
          typeof r["mechanism"] !== "string" ||
          typeof r["action_template"] !== "string" ||
          typeof r["provenance_quote"] !== "string"
        ) {
          continue;
        }
        const candidate: CandidateLesson = {
          title: r["title"],
          coreClaim: r["core_claim"],
          mechanism: r["mechanism"],
          actionTemplate: r["action_template"],
          evidenceStrength,
          provenanceQuote: r["provenance_quote"],
          pageRef: input.pageStart,
          sourceChunkId: input.sourceChunkId,
        };
        if (
          isGrounded(candidate, input.chunkText) &&
          passesLanguageSanity(candidate.title) &&
          passesLanguageSanity(candidate.coreClaim) &&
          passesLanguageSanity(candidate.mechanism) &&
          passesLanguageSanity(candidate.actionTemplate)
        ) {
          rawCandidates.push(candidate);
        }
      }

      const passingCandidates = rawCandidates.filter((c) => passesClaimNotQuote(c));
      if (passingCandidates.length > bestCandidates.length) bestCandidates = passingCandidates;
      if (passingCandidates.length === rawCandidates.length && rawCandidates.length > 0) break;
    }

    return bestCandidates;
  }

  /**
   * Ported from ollama-provider.ts's generateCards prompt. Cloze stays fully
   * heuristic (mechanical, no model needed) regardless of provider, same as
   * every other path in this codebase. `passesTopicality` (free_recall
   * topic-anchoring) is NOT applied here — it needs an embedding this repo
   * doesn't have; anti-leak and card-text-sanity, which don't need one, both
   * are.
   */
  async generateCards(input: GenerateCardsInput): Promise<GeneratedCard[]> {
    const lesson = input.lesson;
    const MAX_ATTEMPTS = 3;
    let bestPassing: GeneratedCard[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's free_recall_prompt failed one of two ways -- either it leaked the answer by reusing its specific words (rewrite so it shares NONE of the answer's key nouns/verbs), or it was so vague it didn't say what the lesson is even about. Name the general topic/subject of the lesson while withholding the specific claim itself.";
      const prompt = `Given this lesson, write retrieval-practice questions that do NOT reveal or restate the answer in the question itself -- the reader must recall it from memory.

Lesson title: ${lesson.title}
Core claim: ${lesson.coreClaim}
Mechanism: ${lesson.mechanism}
Action: ${lesson.actionTemplate}

Write:
1. free_recall_prompt -- names the general topic/subject (so the reader knows which lesson this is) WITHOUT quoting or hinting at the claim's specific content words.
2. application_prompt -- a concrete, situational "you're in situation Y" question, specific enough that answering it requires applying THIS lesson.
3. application_answer -- a 1-2 sentence answer specific to the scenario just described, not a restatement of the generic action_template.
4. why_prompt -- asks the reader to explain the mechanism in their own words, without revealing it.${strictnessNote}`;

      const parsed = await this.callTool(GENERATE_CARDS_SYSTEM_PROMPT, prompt, "generated_cards", GENERATE_CARDS_SCHEMA);
      const isValid = (obj: unknown): obj is Record<string, string> =>
        typeof obj === "object" &&
        obj !== null &&
        typeof (obj as Record<string, unknown>)["free_recall_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_answer"] === "string" &&
        typeof (obj as Record<string, unknown>)["why_prompt"] === "string";
      if (!isValid(parsed)) continue;

      const candidateCards: GeneratedCard[] = [
        { promptType: "free_recall", prompt: parsed["free_recall_prompt"]!, answer: lesson.coreClaim },
        { promptType: "application", prompt: parsed["application_prompt"]!, answer: parsed["application_answer"]! },
        { promptType: "why", prompt: parsed["why_prompt"]!, answer: lesson.mechanism },
      ];

      const passing = candidateCards.filter(
        (c) => passesLanguageSanity(c.prompt) && passesCardTextSanity(c.prompt, c.promptType) && passesAntiLeak(c).passed,
      );
      const hasFreeRecall = passing.some((c) => c.promptType === "free_recall");
      if (passing.length > bestPassing.length) bestPassing = passing;
      if (hasFreeRecall && passing.length === candidateCards.length) break;
    }

    const cards: GeneratedCard[] = [...bestPassing];
    if (!cards.some((c) => c.promptType === "free_recall")) {
      // Never ship without a free_recall card -- the generation effect is
      // the point. The heuristic template is topic-anchor by construction,
      // guaranteed to pass anti-leak.
      const fallback = generateCardsForLesson(lesson).find((c) => c.promptType === "free_recall");
      if (fallback) cards.push(fallback);
    }

    const cloze = buildClozeCard(lesson);
    if (cloze) cards.push(cloze);

    return cards.slice(0, 4);
  }

  triageChunk(_input: ChunkTriageInput): Promise<ChunkTriageResult> {
    throw new Error("DevShimProvider.triageChunk: not implemented -- triage stays heuristic (free, zero-latency) regardless of provider.");
  }
  mergeLessons(_input: MergeLessonsInput): Promise<CandidateLesson[]> {
    throw new Error("DevShimProvider.mergeLessons: not implemented -- item 7's merging stage runs through HeuristicProvider's embedding-less degrade path (clusterAndRank on empty vectors -- selection works, dedup doesn't; see worker-stages.ts), not a real model call.");
  }
  gradeAnswer(_input: GradeAnswerInput): Promise<GradeAnswerResult> {
    throw new Error("DevShimProvider.gradeAnswer: not implemented -- out of item 7's scope, delegates to the heuristic keyword-overlap grader elsewhere.");
  }
}
