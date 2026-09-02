import type {
  ChunkTriageInput,
  ChunkTriageResult,
  ExtractLessonsInput,
  CandidateLesson,
  MergeLessonsInput,
  GenerateCardsInput,
  GeneratedCard,
  GradeAnswerInput,
  GradeAnswerResult,
  EntailmentCheckInput,
  EntailmentCheckResult,
  LlmProvider,
} from "./types";
import { isGrounded } from "./grounding";
import { HeuristicProvider } from "./heuristic-provider";
import {
  buildClozeCard,
  clusterAndRank,
  passesLanguageSanity,
  passesAntiLeak,
  passesClaimNotQuote,
  passesTitleClaimRelevance,
  passesTopicality,
  classifyEvidenceStrength,
  generateCardsForLesson,
  type ScoredCandidate,
} from "../index";

export interface OllamaProviderConfig {
  baseUrl?: string;
  /** Judgment-heavy work: extraction, merge representative selection. */
  extractionModel?: string;
  /** Mechanical work: card phrasing. Smaller/faster model. */
  cardModel?: string;
  /** Set true only if you've measured your OLLAMA_NUM_PARALLEL headroom. */
  embed?: (texts: string[]) => Promise<number[][]>;
  /** Per-attempt timeout for the actual generate call (not the reachability
   * probe, which has its own short one). Generous enough to cover a cold
   * model load plus generation; see the comment on `generateRaw`. */
  generateTimeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_EXTRACTION_MODEL = "qwen2.5:7b-instruct-q4_K_M";
const DEFAULT_CARD_MODEL = "qwen2.5:3b-instruct-q4_K_M";
const DEFAULT_GENERATE_TIMEOUT_MS = 90_000;

/** Reachability probe for provider precedence (Ollama -> gateway -> Heuristic). */
export async function isOllamaReachable(baseUrl = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The real-transformation path, once a local model is available: `core_claim`
 * genuinely restates rather than copies `provenance_quote`, and card prompts
 * don't leak answers — the root cause HeuristicProvider structurally cannot
 * fix (it has no generation capability).
 *
 * Tiered: a larger model for extraction/merge (judgment), a smaller one for
 * card phrasing (mechanical). Triage stays heuristic (free, zero-latency
 * pre-filter) and cloze cards stay heuristic (mechanical, no model needed)
 * regardless of which provider is active.
 */
export class OllamaProvider implements LlmProvider {
  private readonly heuristic: HeuristicProvider;
  private readonly baseUrl: string;
  private readonly extractionModel: string;
  private readonly cardModel: string;
  private readonly embed?: (texts: string[]) => Promise<number[][]>;
  private readonly generateTimeoutMs: number;

  constructor(config: OllamaProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.extractionModel = config.extractionModel ?? DEFAULT_EXTRACTION_MODEL;
    this.cardModel = config.cardModel ?? DEFAULT_CARD_MODEL;
    this.embed = config.embed;
    this.generateTimeoutMs = config.generateTimeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
    this.heuristic = new HeuristicProvider(config.embed);
  }

  /**
   * ULM L6 §3 finding: this fetch previously had NO timeout at all — only
   * `isOllamaReachable`'s separate reachability probe did. Confirmed live
   * against a server that accepts the connection and never responds: the
   * call hung indefinitely. That's the worst failure mode for a leased
   * ingestion job, not a merely-annoying one — a hung generate call would
   * hold whatever lease/lock the worker uses forever and never reach a
   * retry-or-flag path, which only runs once this call throws or returns. A
   * hang looked identical to slow work, forever.
   */
  private async generateRaw(model: string, prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(this.generateTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`ollama generate failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { response: string };
    return data.response;
  }

  /** Strict JSON + retry-once-then-flag. */
  private async generateValidated<T>(
    model: string,
    prompt: string,
    validate: (obj: unknown) => obj is T,
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.generateRaw(model, prompt);
        const parsed: unknown = JSON.parse(raw);
        if (validate(parsed)) return parsed;
      } catch {
        // fall through to retry
      }
    }
    return null;
  }

  async triageChunk(input: ChunkTriageInput): Promise<ChunkTriageResult> {
    // The brief's cheap-model triage doesn't need a model at all here — the
    // existing heuristic salience scoring already answers "does this chunk
    // contain an extractable lesson?" at zero cost/latency.
    return this.heuristic.triageChunk(input);
  }

  async extractLessons(input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    // evidence_strength is classified from the source chunk's own cue
    // phrases, never trusted as the model's self-label — a generative model
    // asked to grade its own claim tends to over-classify confident prose
    // as "strong_research" with no citation in sight. Same source text ->
    // same classification for every candidate from this chunk, so compute
    // it once.
    const evidenceStrength = classifyEvidenceStrength(input.chunkText);

    const MAX_ATTEMPTS = 3;
    let bestCandidates: CandidateLesson[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Don't drop a rejected candidate on first failure — it has a valid
      // quote and a real idea, it just needs to be re-said. Regenerating
      // recovers most of the coverage a first-attempt-only gate would
      // otherwise lose to archaic/dense prose that resists paraphrase.
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's core_claim was rejected — either it was too close to a copy of the quote (shared too much wording/structure), or its title drifted to a different topic than the claim itself. This time, express the claim in clearly different words and sentence structure, and make sure the title is about the SAME specific point as the claim, not just the same general subject.";
      const prompt = `Extract up to 2 distinct teachable lessons from this passage.

Rules:
- Respond entirely in English, regardless of the source language or any other language that appears elsewhere in this conversation.
- FIRST identify the ONE sentence (or short span) in the passage that the lesson is actually about. "provenance_quote" MUST be that exact span, copied verbatim (same words, same order, same punctuation) — it is the specific sentence you are restating, not just any true/interesting sentence elsewhere in the passage. If you cannot point to the specific sentence a claim comes from, do not include that lesson.
- "core_claim" restates THAT SAME sentence's specific point in SUBSTANTIALLY DIFFERENT WORDS — different vocabulary and sentence structure, not the quote with one or two words swapped. Test yourself: if someone read only your core_claim, could they guess most of the quote's exact wording? If yes, rewrite it. A claim that shares its structure or most of its phrasing with the quote will be rejected outright, even if it is otherwise accurate — pick different words, not just a trimmed version of the same words. The claim and the quote must be about the exact same specific point, not just the same general topic — vague-but-different wording that drifts to a related-but-different point is equally wrong.
- "mechanism" must actually explain WHY the claim is true, staying on the same topic as the claim.
- "title" must be short and imperative where natural (e.g. "Use the two-minute rule", not "On starting"), AND must be about the exact same specific point as core_claim — not a different aspect of the same general subject.
- "action_template" must be a specific, concrete action tied to this exact claim, not generic advice.
- If the passage has no extractable lesson, return {"lessons": []}.${strictnessNote}

Passage (page ${input.pageStart}):
"""
${input.chunkText}
"""

Return ONLY strict JSON: {"lessons": [{"title": "...", "core_claim": "...", "mechanism": "...", "action_template": "...", "provenance_quote": "..."}]}`;

      const isValid = (obj: unknown): obj is { lessons: unknown[] } =>
        typeof obj === "object" && obj !== null && Array.isArray((obj as { lessons?: unknown }).lessons);

      const parsed = await this.generateValidated(this.extractionModel, prompt, isValid);
      if (!parsed) continue;

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
        // Independent re-check, same as HeuristicProvider — a model can
        // hallucinate a near-quote just as a heuristic can pick a bad span.
        // NOTE: claim<->provenance semantic relevance (the critical fix for
        // "verbatim but unrelated" quotes) is applied downstream, post-merge
        // — it needs claim+quote embeddings across the whole merged set, and
        // applying it there means it's enforced identically regardless of
        // which provider produced the candidate.
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

      const passingCandidates: CandidateLesson[] = [];
      for (const candidate of rawCandidates) {
        if (!passesClaimNotQuote(candidate)) continue;
        if (this.embed) {
          const [titleEmb, claimEmb] = await this.embed([candidate.title, candidate.coreClaim]);
          if (titleEmb && claimEmb && !passesTitleClaimRelevance(titleEmb, claimEmb).passed) continue;
        }
        passingCandidates.push(candidate);
      }

      if (passingCandidates.length > bestCandidates.length) bestCandidates = passingCandidates;
      if (passingCandidates.length === rawCandidates.length && rawCandidates.length > 0) break; // everything passed
    }

    return bestCandidates;
  }

  async mergeLessons(input: MergeLessonsInput): Promise<CandidateLesson[]> {
    if (input.candidates.length === 0) return [];
    // Same fix as HeuristicProvider.mergeLessons: ONE embed() call for the
    // whole candidate array, not one per candidate — see that file's
    // comment for the measured 1.7x and why per-item calls silently defeat
    // the embedder's own batching.
    let items: ScoredCandidate[];
    if (this.embed) {
      const embeddings = await this.embed(input.candidates.map((c) => c.coreClaim));
      items = input.candidates.map((candidate, i) => ({
        candidate,
        embedding: embeddings[i] ?? [],
      }));
    } else {
      items = input.candidates.map((candidate) => ({ candidate, embedding: [] }));
    }
    // Embedding-based clustering (cheap, already proven) does the dedup —
    // scoped down from an LLM-driven merge pass for this iteration.
    return clusterAndRank(items, input.targetCount.max);
  }

  async generateCards(input: GenerateCardsInput): Promise<GeneratedCard[]> {
    const lesson = input.lesson;
    const MAX_ATTEMPTS = 3;
    let bestPassing: GeneratedCard[] = [];

    // Sessions interleave cards across sources — a free_recall card is read
    // cold, with no idea which lesson it belongs to. The anti-leak-only
    // design over-corrects to unanswerable prompts like "What is the main
    // idea of the lesson?" (zero leak, but also zero topic anchor). The
    // requirement is a BAND, not a ceiling: topically anchored (must name
    // the subject) AND lexically distinct (must not give away the answer's
    // wording) — both checked independently below.
    let claimEmbeddingForTopicality: number[] | null = null;
    if (this.embed) {
      claimEmbeddingForTopicality = (await this.embed([lesson.coreClaim]))[0] ?? null;
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's free_recall_prompt failed one of two ways — either it leaked the answer by reusing its specific words (rewrite so it shares NONE of the answer's key nouns/verbs), or it was so vague it didn't say what the lesson is even about (e.g. \"What is the main idea of the lesson?\" is too vague on its own — a reader can't tell which lesson this is). The prompt must NAME THE GENERAL TOPIC/SUBJECT of the lesson while withholding the specific claim itself — enough to identify the lesson, not enough to answer it.";
      const prompt = `Given this lesson, write retrieval-practice questions that do NOT reveal or restate the answer in the question itself — the reader must recall it from memory.

Lesson title: ${lesson.title}
Core claim: ${lesson.coreClaim}
Mechanism: ${lesson.mechanism}
Action: ${lesson.actionTemplate}

Write:
1. free_recall_prompt — MUST be phrased as "What does this lesson claim about {topic}?" or "According to this lesson, what determines/causes/explains {topic}?" — i.e. it asks the reader to recall the SPECIFIC POINT the lesson makes about a named topic, not just to identify which lesson is being asked about. Name the general topic/subject (so the reader knows which lesson this is — sessions mix cards from many different lessons) WITHOUT quoting or hinting at the claim's specific content words. Bad: "What is the main idea of the lesson?" (no topic named — unanswerable cold). Also bad: "What lesson discusses X?" or "What topic is covered in the lesson about X?" (asks the reader to identify the lesson, not recall its claim — answering "the calmness one" would satisfy the question without recalling anything). Also bad: a prompt that reuses the claim's specific wording (leaks the answer). Good: "What does this lesson claim about the relationship between calmness and how others respond to you?"
2. application_prompt — a concrete, situational "you're in situation Y" question, specific enough that answering it requires applying THIS lesson (not a generic scenario).
3. application_answer — a 1-2 sentence answer to application_prompt that is SPECIFIC to the scenario you just described, not a restatement of the generic action_template.
4. why_prompt — asks the reader to explain the mechanism in their own words, without revealing it.${strictnessNote}

Return ONLY strict JSON: {"free_recall_prompt": "...", "application_prompt": "...", "application_answer": "...", "why_prompt": "..."}`;

      const isValid = (obj: unknown): obj is Record<string, string> =>
        typeof obj === "object" &&
        obj !== null &&
        typeof (obj as Record<string, unknown>)["free_recall_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_answer"] === "string" &&
        typeof (obj as Record<string, unknown>)["why_prompt"] === "string";

      const parsed = await this.generateValidated(this.cardModel, prompt, isValid);
      if (!parsed) continue;

      const candidateCards: GeneratedCard[] = [
        { promptType: "free_recall", prompt: parsed["free_recall_prompt"]!, answer: lesson.coreClaim },
        { promptType: "application", prompt: parsed["application_prompt"]!, answer: parsed["application_answer"]! },
        { promptType: "why", prompt: parsed["why_prompt"]!, answer: lesson.mechanism },
      ];

      const passing: GeneratedCard[] = [];
      for (const c of candidateCards) {
        if (!passesLanguageSanity(c.prompt) || !passesAntiLeak(c).passed) continue;
        if (c.promptType === "free_recall" && this.embed && claimEmbeddingForTopicality) {
          const promptEmb = (await this.embed([c.prompt]))[0];
          if (!promptEmb || !passesTopicality(promptEmb, claimEmbeddingForTopicality).passed) continue;
        }
        passing.push(c);
      }

      // free_recall is the one card type that must never be missing — the
      // generation effect is the whole point. Keep retrying past "some
      // cards pass" until free_recall specifically passes, or attempts run out.
      const hasFreeRecall = passing.some((c) => c.promptType === "free_recall");
      if (passing.length > bestPassing.length) bestPassing = passing;
      if (hasFreeRecall && passing.length === candidateCards.length) break; // everything passed, stop early
    }

    const cards: GeneratedCard[] = [...bestPassing];

    // Still no free_recall after every attempt — never ship without one.
    // The heuristic template is guaranteed to pass anti-leak (topic-anchor
    // design, not a claim restatement).
    if (!cards.some((c) => c.promptType === "free_recall")) {
      const fallback = generateCardsForLesson(lesson).find((c) => c.promptType === "free_recall");
      if (fallback) cards.push(fallback);
    }

    // Cloze stays fully heuristic — mechanical, no model needed.
    const cloze = buildClozeCard(lesson);
    if (cloze) cards.push(cloze);

    if (cards.length === 0) {
      // Everything failed — fall back to the heuristic cards rather than
      // shipping a lesson with zero cards.
      return this.heuristic.generateCards(input);
    }
    return cards.slice(0, 4);
  }

  async gradeAnswer(input: GradeAnswerInput): Promise<GradeAnswerResult> {
    // Out of scope for this pass — delegate to the heuristic keyword-overlap grader.
    return this.heuristic.gradeAnswer(input);
  }

  /**
   * Verbatim + cosine relevance both pass a quote that CONTRADICTS its claim
   * — cosine measures topical closeness, not agreement. This is the final
   * provenance check, run once per surviving (post-merge) lesson — the
   * `verifying_grounding` chunked stage under the resumable-worker cursor
   * model (tracking-app migration `109`); see `../llm/types.ts`'s
   * `EntailmentCheckResult` doc for why this function stays stateless and
   * unaware of chunk position/backfill either way.
   *
   * Uses `extractionModel` (7B), not `cardModel` (3B) — calibrated live in
   * ULM against 5 known-good + 2 known-bad lessons: 3B plateaued at 5-6/7
   * across several prompt revisions (including the chain-of-thought "state
   * the passage's point first" step below, which actually REGRESSED 3B from
   * 6/7 to 5/7); 7B reached 7/7 with that same chain-of-thought step. This
   * is genuinely judgment-heavy work — closer to extraction than to card
   * phrasing.
   */
  async checkEntailment(input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    const prompt = `You are checking whether a source passage backs up a claim that was derived from it as a paraphrase or generalization.

The claim is normally NOT a verbatim restatement of the passage -- it's a summary or a drawn-out implication, written in different words, sometimes about a specific instance of what the passage says more generally (or vice versa). That is expected and should still count as SUPPORTS. Only mark it down if the passage's actual point is a DIFFERENT specific idea than the claim, or the OPPOSITE of the claim.

Example 1 (SUPPORTS): Claim: "Practicing gratitude improves mood." Passage: "Every evening she wrote down three things she was thankful for, and noticed she felt lighter and more at ease by the end of the week." -- SUPPORTS, because the passage is a concrete instance of gratitude practice leading to improved mood, even though it never uses the words "gratitude", "improves", or "mood".

Example 2 (CONTRADICTS): Claim: "Sacrifice motivated by love brings peace." Passage: "He gave up everything out of dread and terror, desperate to avoid punishment." -- CONTRADICTS, because the passage's actual motive is fear and dread, the opposite of the claim's stated motive of love.

Example 3 (UNRELATED): Claim: "Recognizing your inner worth restores your health." Passage: "You are never stuck for good -- you can choose to leave despair behind, and once you commit to that choice, every resource you have will help carry you there." -- UNRELATED, because the passage is about the power of choosing to change one's situation, not about recognizing inner worth, and it never connects to health at all -- a thematically similar passage about self-belief is not evidence for THIS specific claim.

Now judge this pair:

Claim: "${input.claim}"

Passage: "${input.quote}"

First, in one short sentence, state the passage's own specific point in your own words. Then compare it to the claim and decide.

Respond with ONLY a JSON object: {"passage_point": "<one short sentence>", "verdict": "SUPPORTS" | "CONTRADICTS" | "UNRELATED", "reason": "<one short sentence>"}`;

    const isEntailmentResult = (obj: unknown): obj is EntailmentCheckResult => {
      if (typeof obj !== "object" || obj === null) return false;
      const v = (obj as Record<string, unknown>)["verdict"];
      return v === "SUPPORTS" || v === "CONTRADICTS" || v === "UNRELATED";
    };

    const result = await this.generateValidated(this.extractionModel, prompt, isEntailmentResult);
    if (!result) {
      // Fail closed, not open: an entailment check we couldn't get a valid
      // answer from is exactly the situation this gate exists to catch —
      // unlike the mechanism-relevance embedding hiccup elsewhere (which
      // fails open), silently trusting an unreadable claim/quote pair here
      // would defeat the gate's entire purpose.
      return { verdict: "UNRELATED", reason: "entailment check failed to return a valid response" };
    }
    return { verdict: result.verdict, reason: result.reason ?? "" };
  }
}
