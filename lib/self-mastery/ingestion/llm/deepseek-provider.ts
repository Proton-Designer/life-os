/**
 * L9/R6's engine, EXTENDED (2026-09-13, Phase 1 item 3): R6's original
 * ruling drew a hard line at "DeepSeek is the bulk-text summarization
 * engine, not a second lesson-extraction backend" -- true when this file
 * had no funded key and no spend-controlled gateway to call through. Both
 * now exist (a real, operator-funded `DEEPSEEK_API_KEY`; `lib/ai/gateway.ts`'s
 * `gatewayChat()`, with tiering/retry/a hard spend cap/usage logging), so
 * that ruling is SUPERSEDED for the three methods the pipeline actually
 * calls on a real-model provider: `extractLessons`, `generateCards`,
 * `checkEntailment`.
 *
 * `mergeLessons` and `triageChunk` are DELIBERATELY still not implemented,
 * verified rather than assumed: `worker-stages.ts`'s `mergingStage` always
 * calls `heuristic.mergeLessons(...)` directly, never `provider.mergeLessons`,
 * and no call site anywhere in this repo calls `provider.triageChunk` either
 * (triage stays heuristic everywhere -- see Ollama/DevShim's own headers).
 * Implementing either would be dead code nobody calls; `gradeAnswer` is
 * likewise out of this item's scope (no caller needs it from DeepSeek).
 *
 * PROMPTS ARE PORTED, NOT INVENTED. `extractLessons`/`generateCards` reuse
 * `dev-shim-provider.ts`'s own system/user prompt split verbatim -- that
 * file's own header already documents it as "ported near-verbatim from
 * ollama-provider.ts's own (already measured-against-real-books) versions,"
 * i.e. it is already the system+user-shaped port this file's chat/completions
 * transport needs; only the transport changed (plain JSON-in-content here,
 * vs. DevShim's tool-forced JSON-schema call and Ollama's raw `format:"json"`
 * generate). `checkEntailment` ports OLLAMA's fuller prompt specifically
 * (the 3 worked examples + the "state the passage's own point first"
 * chain-of-thought step) rather than DevShim's terser one -- ollama-provider.ts's
 * own comment records this exact prompt calibrated live to 7/7 on known-good/
 * known-bad pairs, and this is a hallucination firewall gate, not a place to
 * economize on prompt quality.
 *
 * THINKING IS DISABLED ON EVERY CALL THIS CLASS MAKES, deliberately -- see
 * `chatJson`'s own comment for why and what to do if quality suffers without
 * it (report it, do not silently re-enable it).
 *
 * Deliberately thin otherwise: no key resolution of its own (that's
 * `gatewayChat`'s job, via `resolveApiKeyWithSource` -- the book owner's own
 * BYO key if they have one, the operator-funded `DEEPSEEK_API_KEY` server
 * key otherwise, same resolution order every other gateway caller gets).
 * No retry policy of its own either -- `gatewayChat`'s `withRetry` already
 * covers transient failures (429/5xx); this class's own MAX_ATTEMPTS loops
 * on `extractLessons`/`generateCards` are a DIFFERENT thing -- recovering
 * from a syntactically-valid-but-substantively-rejected model answer (a
 * copied-not-restated claim, a title that drifted topic), which no amount
 * of network-level retry can fix.
 *
 * PROVIDER-AGNOSTIC DESPITE THE NAME, as of the multi-provider gateway
 * reversal (2026-09-15, the Lead): this class no longer picks DeepSeek by
 * being called -- `gatewayChat` resolves the book owner's own saved
 * provider preference itself (lib/ai/preferences.ts) whenever a call site
 * here omits `provider`, which every call site in this file does. `tier` is
 * the one thing still pinned explicitly, to `"cheap"` (Addition A, below) --
 * the PROVIDER a book gets processed on follows its owner's own choice.
 * The class keeps its original name because renaming it is a bigger,
 * separate change than this reversal needs (confirmed with the Lead as
 * sufficient); read it as "the ingestion LLM provider adapter," not "the
 * adapter that only talks to DeepSeek."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
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
  SummarizeSectionInput,
  SummarizeSectionResult,
  ExtractLessonsBatchResult,
  GenerateCardsBatchResult,
  LlmProvider,
} from "./types";
import { gatewayChat } from "@/lib/ai/gateway";
import type { ChatResult } from "@/lib/ai/client";
import { isGrounded } from "./grounding";
import type { EvidenceStrength } from "./types";
import { classifyEvidenceStrength } from "../evidence-strength";
import { passesLanguageSanity, passesClaimNotQuote, passesAntiLeak, passesCardTextSanity } from "../invariants";
import { buildClozeCard, generateCardsForLesson } from "../cards";

const DEAD_METHOD =
  "not implemented -- verified dead for this provider: no call site in this repo invokes it on a real (non-heuristic) LlmProvider. See this file's own header before implementing it -- confirm a real caller first.";

const MAX_TOKENS_SUMMARIZE = 400;
// Right-sized 2026-09-14 (BUG-1's layer 2), from real data, not intuition:
// across all 182 successful production extractLessons calls logged in
// ai_usage_log, completion_tokens p50=348, p90=412, p99=446, max=458. 600
// is ~30% headroom above the observed max -- comfortable for legitimate
// variance, while cutting a runaway/looping generation's worst case well
// under half of the old 1000. This does not fix BUG-1 by itself (the root
// cause is a real, non-deterministic DeepSeek generation stall -- the same
// chunk 0 text succeeded in an earlier ingest of this same title), it
// bounds how long a stall can run before hitting the cap; layer 1 (route.ts's
// skip-and-advance on exhausted attempts) is what makes a stall harmless
// to the rest of the book regardless of how long any one call takes.
const MAX_TOKENS_EXTRACT = 600;
const MAX_TOKENS_CARDS = 600;
const MAX_TOKENS_ENTAILMENT = 220;

/**
 * P2-14 batch mode. `BATCH_SIZE_*` is how many chunks/lessons
 * `worker-stages.ts` combines into one call -- kept here, not there,
 * because it's the token-budget math below that actually bounds it, not a
 * pipeline concern. `MAX_TOKENS_*_BATCH` is `MAX_TOKENS_*` per item times
 * the batch size (each passage/lesson's own output is independent of the
 * others, so the combined budget scales linearly -- same calibration basis
 * as `MAX_TOKENS_EXTRACT`'s own header, just multiplied rather than
 * re-measured, since production batch data doesn't exist yet). 4 was
 * chosen, not derived: small enough that a combined prompt for even the
 * largest real chunks stays well inside `INGESTION_BATCH_TIMEOUT_MS`, large
 * enough to meaningfully cut the call count (4x fewer calls, not 1.5x).
 */
export const BATCH_SIZE_EXTRACT = 4;
export const BATCH_SIZE_CARDS = 4;
const MAX_TOKENS_EXTRACT_BATCH = MAX_TOKENS_EXTRACT * BATCH_SIZE_EXTRACT;
const MAX_TOKENS_CARDS_BATCH = MAX_TOKENS_CARDS * BATCH_SIZE_CARDS;
// Longer than INGESTION_LONG_TIMEOUT_MS (60s): a combined prompt/response is
// several times bigger, and unlike the single-item calls there is no
// MAX_ATTEMPTS retry loop eating into the SAME budget here (see
// extractLessonsBatch's own header) -- one call gets the full margin
// instead of splitting it across up to 3 attempts. Still well inside
// route.ts's maxDuration=280 with real room left for the DB writes and a
// possible per-chunk fallback loop on top.
const INGESTION_BATCH_TIMEOUT_MS = 100_000;

/**
 * FOUND LIVE (2026-09-14, Phase 1 #5's first real production book): every
 * gatewayChat call defaulted to client.ts's global 20s TIMEOUT_MS, and a
 * real extractLessons call over a 2-4k-token chunk does not finish in 20s
 * from Vercel -- confirmed failing twice with errorKind:"timeout" against
 * a real book (ingestion_job_stage_attempts), never against the local dev
 * shim or a mocked test, which is why this went unnoticed until a real
 * production run existed to find it.
 *
 * 60s for extraction/cards, not client.ts's 20s default and not the
 * route's full 280s ceiling: generous headroom over what a bounded
 * (1000/600 max_tokens) completion should need even under load, while
 * `INGESTION_RETRY`'s maxAttempts:2 keeps the worst case for ONE call at
 * 2x this value -- 120s for extraction/cards, well inside route.ts's
 * maxDuration=280 with real margin left for auth/claim/DB writes. 30s for
 * entailment: its own output budget (MAX_TOKENS_ENTAILMENT=220) is a
 * fraction of extraction's/cards', and it already runs with no MAX_ATTEMPTS
 * loop of its own (checkEntailment's own header), so it needs less margin,
 * not more.
 *
 * WHY maxAttempts:2 HERE, NOT THE GATEWAY'S DEFAULT 3: this is a
 * DELIBERATE reduction, not an oversight. The default 3 exists for short
 * interactive calls (answer feedback, verifyKey) where a sub-second-to-
 * single-digit-second in-request retry is nearly free. At 60-90s per
 * attempt that reasoning inverts -- 3 attempts would risk 180-270s inside
 * ONE cron invocation for a single call, eating nearly the whole 280s
 * budget on ONE of several calls a stage handler might need to make, and a
 * timeout that repeats under real load is more likely CORRELATED (the same
 * slow moment) than independent, so a same-request retry is the least
 * likely retry to actually help. The ingestion cursor's own stage-level
 * retry (`ingestion_jobs.max_attempts`, 3, migration 074) already covers
 * genuine persistence across SEPARATE cron invocations a minute apart --
 * a real "try again later," not a same-request retry. `errorKind:"timeout"`
 * stays in retry.ts's RETRYABLE_KINDS unchanged (still correct for short
 * calls); this narrows the ATTEMPT COUNT for these three calls specifically,
 * via the gateway's existing per-call `retry` option, rather than changing
 * the shared classification for every caller.
 */
const INGESTION_LONG_TIMEOUT_MS = 60_000;
const ENTAILMENT_TIMEOUT_MS = 30_000;
const INGESTION_RETRY = { maxAttempts: 2 };

/** Mirrors DevShimProvider's own `lastUsage` convention (dev-shim-provider.ts)
 * -- read by worker-stages.ts's telemetry (`provider.lastUsage?.promptTokens`)
 * and by the calibration harness. `costUsd` is the gateway's own estimate
 * (lib/ai/pricing.ts), not a separate calculation -- one source of truth for
 * what a call cost. */
export interface DeepSeekUsage {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

/** Strips a ```json ... ``` (or bare ```) fence if the model wrapped its
 * JSON in one despite being asked not to -- chat/completions has no
 * Ollama-style `format:"json"` hard guarantee, so this is cheap insurance
 * before JSON.parse, not a substitute for the retry-on-invalid-shape loop
 * below. */
function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

const EXTRACT_LESSONS_SYSTEM_PROMPT =
  "You extract teachable lessons from book passages. Respond entirely in English regardless of the source language.";

const GENERATE_CARDS_SYSTEM_PROMPT =
  "You write retrieval-practice study questions from a lesson, without revealing the answer in the question.";

const ENTAILMENT_SYSTEM_PROMPT =
  "You are checking whether a source passage backs up a claim that was derived from it as a paraphrase or generalization. The claim is normally NOT a verbatim restatement of the passage. Only mark it down if the passage's actual point is a DIFFERENT specific idea than the claim, or the OPPOSITE of the claim.";

/**
 * BUG-1 layer 1 (2026-09-14). Thrown by `chatJson` in place of a plain
 * `Error` so a caller several frames up (route.ts's exhausted-attempts
 * handling) can tell WHY the gateway call failed without string-matching a
 * message. A plain `Error` loses `result.errorKind`/`result.capBlocked`
 * the moment it's thrown -- this class is the one place that information
 * survives the throw. `errorKind`/`capBlocked` are exactly `GatewayChatResult`'s
 * own fields (gateway.ts); this type carries only what a caller needs to
 * decide "is this a content-shaped failure (safe to skip this one chunk)
 * or an infrastructure/budget failure (must not be silently skipped past)."
 */
export type AiBlockKind = "no_key" | "monthly_cap" | "global_cap";

export class GatewayCallFailedError extends Error {
  /**
   * Set when the gateway refused the call for a reason that is about the ACCOUNT, not the content: no key at all, this
   * user's monthly budget, or the shared budget. Taken from the gateway's typed flags (never the message text). Retrying
   * the same call cannot succeed until something outside changes, so the route fails the book at once instead.
   */
  public readonly blockKind?: AiBlockKind;

  constructor(
    message: string,
    public readonly errorKind?: ChatResult["errorKind"],
    public readonly capBlocked?: boolean,
    aiBlock?: "no_key" | "monthly_cap",
  ) {
    super(message);
    this.name = "GatewayCallFailedError";
    this.blockKind = capBlocked ? "global_cap" : aiBlock;
  }
}

export class DeepSeekProvider implements LlmProvider {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
  ) {}

  public lastUsage: DeepSeekUsage | null = null;

  /**
   * The one place this class talks to the network, always through
   * `gatewayChat` -- never `lib/ai/client.ts`'s `chat()` directly, never
   * `fetch` -- so tiering (cheap/deepseek-flash), the shared spend cap,
   * structured retry, and usage logging apply uniformly to every call this
   * provider makes, the same guarantee every other gateway-backed feature
   * gets (see lib/ai/gateway.ts's own header: "a feature that calls chat()
   * directly gets none of them").
   *
   * `thinking: false` on every call, unconditionally, deliberately: E1
   * measured 24 of 26 output tokens going to hidden `reasoning_content` on
   * a trivial call, and DeepSeek bills reasoning tokens as ordinary OUTPUT
   * (lib/ai/pricing.ts) -- for bulk per-chunk/per-lesson ingestion work
   * (66 calls for one book just for extraction) that multiplier is the
   * single biggest cost lever available, and there is no product reason
   * ingestion needs hidden chain-of-thought the visible JSON answer
   * doesn't already carry. If real-book calibration shows extraction/card/
   * entailment QUALITY measurably degrading without reasoning, that is a
   * genuine cost-vs-quality trade-off for the Lead to decide -- report it,
   * do not silently flip this back to `true`.
   *
   * FAIL-CLOSED ON A GENUINE CALL FAILURE (`ok:false`): no key, spend-cap
   * refusal, auth, rate limit, network error, or an empty-content 2xx are
   * all infrastructure failures a retry inside this function cannot fix --
   * THROWS immediately rather than returning `null`, so a caller's own
   * retry-with-strictness-note loop (built for genuine model noise) can
   * never mistake "the shared budget ran out" or "the key was rejected" for
   * "the model didn't find a lesson in this chunk." Returns `null` ONLY
   * when the call itself succeeded (real tokens billed, `lastUsage` set)
   * but the content didn't parse into valid JSON of the expected shape --
   * that IS retriable model noise, same posture ollama-provider.ts's
   * `generateValidated` already established for its own retry loop.
   */
  private async chatJson<T>(
    feature: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    validate: (obj: unknown) => obj is T,
    callOpts?: { timeoutMs?: number; retry?: { maxAttempts?: number } },
  ): Promise<T | null> {
    const result = await gatewayChat(
      this.supabase,
      this.userId,
      feature,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // tier explicitly "cheap" (Phase 1 multi-provider, Addition A, the
      // Lead): bulk ingestion runs hundreds of calls per book -- it must
      // NEVER silently ride a user's chosen "capable"/flagship tier, which
      // would spend several real dollars of THEIR money per book. This was
      // already gatewayChat's default before this line existed; made
      // explicit here so it survives a future change to that default
      // without ingestion cost silently changing with it. The grounding
      // quality gate (verifyGroundingStage), not model size, is what
      // protects extraction quality -- see the Lead's own reasoning.
      { maxTokens, thinking: false, tier: "cheap", timeoutMs: callOpts?.timeoutMs, retry: callOpts?.retry },
    );
    if (result.usage) {
      this.lastUsage = {
        promptTokens: result.usage.promptTokens,
        cachedPromptTokens: result.usage.cachedPromptTokens,
        completionTokens: result.usage.completionTokens,
        reasoningTokens: result.usage.reasoningTokens,
        costUsd: result.costUsd ?? 0,
      };
    }
    if (!result.ok) {
      throw new GatewayCallFailedError(
        `DeepSeekProvider(${feature}): gateway call failed -- ${result.message ?? "unknown error"}`,
        result.errorKind,
        result.capBlocked,
        result.noKey ? "no_key" : result.monthlyCapBlocked ? "monthly_cap" : undefined,
      );
    }
    try {
      const parsed: unknown = JSON.parse(stripJsonFence(result.content ?? ""));
      return validate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async summarizeSection(input: SummarizeSectionInput): Promise<SummarizeSectionResult> {
    const result = await gatewayChat(
      this.supabase,
      this.userId,
      "self_mastery_ingestion_summarize_section",
      [
        {
          role: "system",
          content:
            "You write a short, faithful summary of one chapter/section of a nonfiction book, from the excerpts provided. " +
            "Summarize the ideas in your own words -- do not quote long passages verbatim. Do not invent claims the excerpts don't support. " +
            "Plain prose, no headings, no bullet points, 2-4 sentences.",
        },
        {
          role: "user",
          content:
            `Book: "${input.bookTitle}"\nSection: "${input.sectionTitle}"\n\nExcerpts from this section, in order:\n\n${input.chunkTexts.join("\n\n---\n\n")}`,
        },
      ],
      // thinking: false is a BEHAVIOR CHANGE from this method's pre-gateway
      // form, worth flagging: the old direct `chat()` call never set
      // `thinking` at all, which means it was silently paying DeepSeek's
      // default thinking-ON cost on every summarization call since this
      // method was written -- undiscovered because summarizeBookSections
      // is "NEVER INVOKED AUTOMATICALLY" (see summarize-sections.ts's own
      // header) and has apparently never been run against a real key. Same
      // cost reasoning as every other call in this file now applies here.
      // tier explicitly "cheap" -- same Addition A reasoning as chatJson's
      // own call site above.
      { maxTokens: MAX_TOKENS_SUMMARIZE, temperature: 0.2, thinking: false, tier: "cheap" },
    );
    if (result.usage) {
      this.lastUsage = {
        promptTokens: result.usage.promptTokens,
        cachedPromptTokens: result.usage.cachedPromptTokens,
        completionTokens: result.usage.completionTokens,
        reasoningTokens: result.usage.reasoningTokens,
        costUsd: result.costUsd ?? 0,
      };
    }
    if (!result.ok || !result.content) {
      throw new Error(`DeepSeekProvider.summarizeSection: ${result.message ?? "the call failed"}`);
    }
    return { summary: result.content.trim() };
  }

  /**
   * Ported from dev-shim-provider.ts's own extractLessons (itself ported
   * from ollama-provider.ts) -- same rules text, same retry-with-
   * strictness-note shape (MAX_ATTEMPTS=3, best-so-far kept across
   * attempts), same write-time gates applied here: `isGrounded` (verbatim
   * substring firewall, grounding.ts), `passesLanguageSanity`,
   * `passesClaimNotQuote`. NOT applied here, same as DevShim: `
   * passesTitleClaimRelevance` and the merge-time claim/provenance cosine
   * floor both need an embedding this repo doesn't have (ADR-003).
   * `evidenceStrength` is classified from the chunk's own source text,
   * never the model's self-label -- same reasoning as every other provider.
   */
  /**
   * Shared by `extractLessons` and P2-14's `extractLessonsBatch` -- the
   * per-candidate shape check + `isGrounded`/language-sanity write-time
   * gates + `passesClaimNotQuote` filter are identical regardless of
   * whether the raw `lessons` array came from a single-passage call or one
   * slot of a combined batch call.
   */
  private parseLessonCandidates(
    rawLessons: unknown[],
    evidenceStrength: EvidenceStrength,
    pageStart: number,
    sourceChunkId: string,
    chunkText: string,
  ): { raw: CandidateLesson[]; passing: CandidateLesson[] } {
    const raw: CandidateLesson[] = [];
    for (const r of rawLessons) {
      if (typeof r !== "object" || r === null) continue;
      const rr = r as Record<string, unknown>;
      if (
        typeof rr["title"] !== "string" ||
        typeof rr["core_claim"] !== "string" ||
        typeof rr["mechanism"] !== "string" ||
        typeof rr["action_template"] !== "string" ||
        typeof rr["provenance_quote"] !== "string"
      ) {
        continue;
      }
      const candidate: CandidateLesson = {
        title: rr["title"],
        coreClaim: rr["core_claim"],
        mechanism: rr["mechanism"],
        actionTemplate: rr["action_template"],
        evidenceStrength,
        provenanceQuote: rr["provenance_quote"],
        pageRef: pageStart,
        sourceChunkId,
      };
      // Independent re-check, same as every other provider -- a model can
      // hallucinate a near-quote just as a heuristic can pick a bad span.
      if (
        isGrounded(candidate, chunkText) &&
        passesLanguageSanity(candidate.title) &&
        passesLanguageSanity(candidate.coreClaim) &&
        passesLanguageSanity(candidate.mechanism) &&
        passesLanguageSanity(candidate.actionTemplate)
      ) {
        raw.push(candidate);
      }
    }
    return { raw, passing: raw.filter((c) => passesClaimNotQuote(c)) };
  }

  async extractLessons(input: ExtractLessonsInput): Promise<CandidateLesson[]> {
    const evidenceStrength = classifyEvidenceStrength(input.chunkText);
    const MAX_ATTEMPTS = 3;
    let bestCandidates: CandidateLesson[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's core_claim was rejected -- either it was too close to a copy of the quote (shared too much wording/structure), or its title drifted to a different topic than the claim itself. This time, express the claim in clearly different words and sentence structure, and make sure the title is about the SAME specific point as the claim, not just the same general subject.";
      const userPrompt = `Extract up to 2 distinct teachable lessons from this passage.

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
"""

Return ONLY strict JSON: {"lessons": [{"title": "...", "core_claim": "...", "mechanism": "...", "action_template": "...", "provenance_quote": "..."}]}`;

      const isValid = (obj: unknown): obj is { lessons: unknown[] } =>
        typeof obj === "object" && obj !== null && Array.isArray((obj as { lessons?: unknown }).lessons);

      const parsed = await this.chatJson(
        "self_mastery_ingestion_extract_lessons",
        EXTRACT_LESSONS_SYSTEM_PROMPT,
        userPrompt,
        MAX_TOKENS_EXTRACT,
        isValid,
        { timeoutMs: INGESTION_LONG_TIMEOUT_MS, retry: INGESTION_RETRY },
      );
      if (!parsed) continue;

      const { raw: rawCandidates, passing: passingCandidates } = this.parseLessonCandidates(
        parsed.lessons,
        evidenceStrength,
        input.pageStart,
        input.sourceChunkId,
        input.chunkText,
      );
      if (passingCandidates.length > bestCandidates.length) bestCandidates = passingCandidates;
      if (passingCandidates.length === rawCandidates.length && rawCandidates.length > 0) break; // everything passed
    }

    return bestCandidates;
  }

  /**
   * P2-14 batch mode: ONE combined call for up to `BATCH_SIZE_EXTRACT`
   * passages, not a loop of `extractLessons` -- fewer calls at lower total
   * cost is the entire point. Deliberately NO strictness-note retry loop
   * here, unlike the single-item method: a malformed shape or a
   * wrong-length `results` array (partial or extra entries) makes EVERY
   * slot `null` rather than guessing which result maps to which passage --
   * the ONLY caller (worker-stages.ts's batch-mode extractingLessonsStage)
   * is responsible for falling back to `extractLessons` (which DOES have
   * the retry loop) for `null` slots. Retrying the whole combined call
   * itself here would cost as much as the fallback while adding latency
   * for no extra reliability the fallback doesn't already provide.
   *
   * `inputs.length <= 1` degrades to the plain single-item call -- there is
   * no combined-prompt benefit to "batching" zero or one passage.
   */
  async extractLessonsBatch(inputs: ExtractLessonsInput[]): Promise<ExtractLessonsBatchResult> {
    if (inputs.length === 0) return { perChunk: [] };
    if (inputs.length === 1) return { perChunk: [await this.extractLessons(inputs[0]!)] };

    const passages = inputs
      .map((input, i) => `Passage ${i} (page ${input.pageStart}):\n"""\n${input.chunkText}\n"""`)
      .join("\n\n");
    const userPrompt = `Extract up to 2 distinct teachable lessons from EACH of the ${inputs.length} passages below, INDEPENDENTLY -- never mix content across passages, and a provenance_quote for passage N must come verbatim from passage N only.

Rules (apply to every passage separately):
- FIRST identify the ONE sentence (or short span) in that passage the lesson is actually about. "provenance_quote" MUST be that exact span, copied verbatim (same words, same order, same punctuation) from THAT passage. If a passage has no extractable lesson, give it an empty lessons array -- do not invent one from a different passage.
- "core_claim" restates that same sentence's specific point in SUBSTANTIALLY DIFFERENT WORDS -- not the quote with a word or two swapped.
- "mechanism" must explain WHY the claim is true, staying on the same topic.
- "title" must be short and imperative where natural, about the exact same specific point as core_claim.
- "action_template" must be a specific, concrete action tied to this exact claim, not generic advice.

${passages}

Return ONLY strict JSON: {"results": [{"lessons": [{"title": "...", "core_claim": "...", "mechanism": "...", "action_template": "...", "provenance_quote": "..."}]}, ...]} -- exactly ${inputs.length} entries in "results", in the SAME ORDER as the passages above (results[i] is for Passage i).`;

    const isValid = (obj: unknown): obj is { results: unknown[] } =>
      typeof obj === "object" && obj !== null && Array.isArray((obj as { results?: unknown }).results);

    const parsed = await this.chatJson(
      "self_mastery_ingestion_extract_lessons_batch",
      EXTRACT_LESSONS_SYSTEM_PROMPT,
      userPrompt,
      Math.min(MAX_TOKENS_EXTRACT_BATCH, MAX_TOKENS_EXTRACT * inputs.length),
      isValid,
      { timeoutMs: INGESTION_BATCH_TIMEOUT_MS, retry: { maxAttempts: 1 } },
    );

    if (!parsed || parsed.results.length !== inputs.length) {
      // Malformed shape, or a wrong-length array -- never guess which
      // entry maps to which passage. Every slot falls back to the
      // single-item call, none silently treated as "no lessons."
      return { perChunk: inputs.map(() => null) };
    }

    return {
      perChunk: inputs.map((input, i) => {
        const entry = parsed.results[i];
        if (typeof entry !== "object" || entry === null || !Array.isArray((entry as { lessons?: unknown }).lessons)) {
          return null;
        }
        const { passing } = this.parseLessonCandidates(
          (entry as { lessons: unknown[] }).lessons,
          classifyEvidenceStrength(input.chunkText),
          input.pageStart,
          input.sourceChunkId,
          input.chunkText,
        );
        return passing; // may legitimately be [] -- "no lessons in this passage," not a failure
      }),
    };
  }

  /**
   * Ported from dev-shim-provider.ts's own generateCards (itself ported
   * from ollama-provider.ts). Cloze stays fully heuristic regardless of
   * provider, same as every other path in this codebase.
   * `passesTopicality` (free_recall topic-anchoring) is NOT applied here --
   * needs an embedding this repo doesn't have; anti-leak and
   * card-text-sanity, which don't need one, both are.
   */
  /** Shared by `generateCards` and P2-14's `generateCardsBatch`. */
  private buildCardCandidates(
    fields: Record<string, string>,
    lesson: CandidateLesson,
  ): { candidateCards: GeneratedCard[]; passing: GeneratedCard[] } {
    const candidateCards: GeneratedCard[] = [
      { promptType: "free_recall", prompt: fields["free_recall_prompt"]!, answer: lesson.coreClaim },
      { promptType: "application", prompt: fields["application_prompt"]!, answer: fields["application_answer"]! },
      { promptType: "why", prompt: fields["why_prompt"]!, answer: lesson.mechanism },
    ];
    const passing = candidateCards.filter(
      (c) => passesLanguageSanity(c.prompt) && passesCardTextSanity(c.prompt, c.promptType) && passesAntiLeak(c).passed,
    );
    return { candidateCards, passing };
  }

  /** Shared by `generateCards` and P2-14's `generateCardsBatch` -- the
   * free_recall guarantee + cloze append apply uniformly regardless of
   * whether the passing cards came from a single-lesson call, one slot of
   * a combined batch call, or a per-lesson fallback after a malformed
   * batch response. */
  private finalizeCards(passing: GeneratedCard[], lesson: CandidateLesson): GeneratedCard[] {
    const cards: GeneratedCard[] = [...passing];
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

  async generateCards(input: GenerateCardsInput): Promise<GeneratedCard[]> {
    const lesson = input.lesson;
    const MAX_ATTEMPTS = 3;
    let bestPassing: GeneratedCard[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const strictnessNote =
        attempt === 0
          ? ""
          : "\nIMPORTANT: a previous attempt's free_recall_prompt failed one of two ways -- either it leaked the answer by reusing its specific words (rewrite so it shares NONE of the answer's key nouns/verbs), or it was so vague it didn't say what the lesson is even about. Name the general topic/subject of the lesson while withholding the specific claim itself.";
      const userPrompt = `Given this lesson, write retrieval-practice questions that do NOT reveal or restate the answer in the question itself -- the reader must recall it from memory.

Lesson title: ${lesson.title}
Core claim: ${lesson.coreClaim}
Mechanism: ${lesson.mechanism}
Action: ${lesson.actionTemplate}

Write:
1. free_recall_prompt -- names the general topic/subject (so the reader knows which lesson this is) WITHOUT quoting or hinting at the claim's specific content words.
2. application_prompt -- a concrete, situational "you're in situation Y" question, specific enough that answering it requires applying THIS lesson.
3. application_answer -- a 1-2 sentence answer specific to the scenario just described, not a restatement of the generic action_template.
4. why_prompt -- asks the reader to explain the mechanism in their own words, without revealing it.${strictnessNote}

Return ONLY strict JSON: {"free_recall_prompt": "...", "application_prompt": "...", "application_answer": "...", "why_prompt": "..."}`;

      const isValid = (obj: unknown): obj is Record<string, string> =>
        typeof obj === "object" &&
        obj !== null &&
        typeof (obj as Record<string, unknown>)["free_recall_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_prompt"] === "string" &&
        typeof (obj as Record<string, unknown>)["application_answer"] === "string" &&
        typeof (obj as Record<string, unknown>)["why_prompt"] === "string";

      const parsed = await this.chatJson(
        "self_mastery_ingestion_generate_cards",
        GENERATE_CARDS_SYSTEM_PROMPT,
        userPrompt,
        MAX_TOKENS_CARDS,
        isValid,
        { timeoutMs: INGESTION_LONG_TIMEOUT_MS, retry: INGESTION_RETRY },
      );
      if (!parsed) continue;

      const { candidateCards, passing } = this.buildCardCandidates(parsed, lesson);
      const hasFreeRecall = passing.some((c) => c.promptType === "free_recall");
      if (passing.length > bestPassing.length) bestPassing = passing;
      if (hasFreeRecall && passing.length === candidateCards.length) break;
    }

    return this.finalizeCards(bestPassing, lesson);
  }

  /**
   * P2-14 batch mode: ONE combined call for up to `BATCH_SIZE_CARDS`
   * lessons. Same posture as `extractLessonsBatch` -- no strictness-note
   * retry loop here; a malformed shape or wrong-length `results` array
   * makes every slot `null`, and the caller falls back to `generateCards`
   * (which has the retry loop AND the free_recall/cloze guarantee) for
   * those lessons specifically.
   */
  async generateCardsBatch(inputs: GenerateCardsInput[]): Promise<GenerateCardsBatchResult> {
    if (inputs.length === 0) return { perLesson: [] };
    if (inputs.length === 1) return { perLesson: [await this.generateCards(inputs[0]!)] };

    const lessons = inputs
      .map((input, i) => {
        const l = input.lesson;
        return `Lesson ${i}:\nTitle: ${l.title}\nCore claim: ${l.coreClaim}\nMechanism: ${l.mechanism}\nAction: ${l.actionTemplate}`;
      })
      .join("\n\n");
    const userPrompt = `For EACH of the ${inputs.length} lessons below, write retrieval-practice questions that do NOT reveal or restate the answer in the question itself -- the reader must recall it from memory. Treat each lesson independently -- never mix content across lessons.

For each lesson write:
1. free_recall_prompt -- names the general topic/subject (so the reader knows which lesson this is) WITHOUT quoting or hinting at the claim's specific content words.
2. application_prompt -- a concrete, situational "you're in situation Y" question, specific enough that answering it requires applying THIS lesson.
3. application_answer -- a 1-2 sentence answer specific to the scenario just described, not a restatement of the generic action_template.
4. why_prompt -- asks the reader to explain the mechanism in their own words, without revealing it.

${lessons}

Return ONLY strict JSON: {"results": [{"free_recall_prompt": "...", "application_prompt": "...", "application_answer": "...", "why_prompt": "..."}, ...]} -- exactly ${inputs.length} entries, in the SAME ORDER as the lessons above (results[i] is for Lesson i).`;

    const isValid = (obj: unknown): obj is { results: unknown[] } =>
      typeof obj === "object" && obj !== null && Array.isArray((obj as { results?: unknown }).results);

    const parsed = await this.chatJson(
      "self_mastery_ingestion_generate_cards_batch",
      GENERATE_CARDS_SYSTEM_PROMPT,
      userPrompt,
      Math.min(MAX_TOKENS_CARDS_BATCH, MAX_TOKENS_CARDS * inputs.length),
      isValid,
      { timeoutMs: INGESTION_BATCH_TIMEOUT_MS, retry: { maxAttempts: 1 } },
    );

    if (!parsed || parsed.results.length !== inputs.length) {
      return { perLesson: inputs.map(() => null) };
    }

    const isCardFields = (obj: unknown): obj is Record<string, string> =>
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as Record<string, unknown>)["free_recall_prompt"] === "string" &&
      typeof (obj as Record<string, unknown>)["application_prompt"] === "string" &&
      typeof (obj as Record<string, unknown>)["application_answer"] === "string" &&
      typeof (obj as Record<string, unknown>)["why_prompt"] === "string";

    return {
      perLesson: inputs.map((input, i) => {
        const entry = parsed.results[i];
        if (!isCardFields(entry)) return null;
        const { passing } = this.buildCardCandidates(entry, input.lesson);
        return this.finalizeCards(passing, input.lesson);
      }),
    };
  }

  /**
   * Ports OLLAMA's checkEntailment prompt specifically (not DevShim's
   * terser one) -- see this file's header for why: ollama-provider.ts's own
   * comment records this exact wording (3 worked examples + a "state the
   * passage's own point first" chain-of-thought step) calibrated live
   * against known-good/known-bad pairs to 7/7 on a 7B-class model; this is
   * the hallucination-firewall gate `verifyGroundingStage` acts on, not a
   * place to economize on prompt quality for a shorter prompt.
   *
   * Single call, no MAX_ATTEMPTS retry loop -- matches DevShimProvider's
   * own checkEntailment shape (one `callTool`, no internal retry), which
   * keeps the cost model exactly "1 entailment call per surviving lesson,"
   * not up to 3. FAILS CLOSED on a parse/shape failure from a call that
   * itself succeeded -- returns `{verdict: "UNRELATED", ...}`, the same
   * explicit fallback ollama-provider.ts's own checkEntailment uses ("Fail
   * closed, not open: ... silently trusting an unreadable claim/quote pair
   * here would defeat the gate's entire purpose"). A call that did NOT
   * succeed (`chatJson` throwing) is a different failure class entirely and
   * is NOT caught here -- it propagates to `verifyGroundingStage`, which
   * documents exactly why that must retry rather than be swallowed into a
   * verdict.
   */
  async checkEntailment(input: EntailmentCheckInput): Promise<EntailmentCheckResult> {
    const userPrompt = `The claim is normally NOT a verbatim restatement of the passage -- it's a summary or a drawn-out implication, written in different words, sometimes about a specific instance of what the passage says more generally (or vice versa). That is expected and should still count as SUPPORTS. Only mark it down if the passage's actual point is a DIFFERENT specific idea than the claim, or the OPPOSITE of the claim.

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

    const result = await this.chatJson(
      "self_mastery_ingestion_check_entailment",
      ENTAILMENT_SYSTEM_PROMPT,
      userPrompt,
      MAX_TOKENS_ENTAILMENT,
      isEntailmentResult,
      { timeoutMs: ENTAILMENT_TIMEOUT_MS, retry: INGESTION_RETRY },
    );
    if (!result) {
      // Fail closed, not open -- see this method's own doc comment. This
      // branch is ONLY reached when the call itself succeeded (chatJson
      // would have thrown otherwise) but the content didn't parse into a
      // valid verdict shape.
      return { verdict: "UNRELATED", reason: "entailment check failed to return a valid response" };
    }
    return { verdict: result.verdict, reason: result.reason ?? "" };
  }

  async triageChunk(_input: ChunkTriageInput): Promise<ChunkTriageResult> {
    throw new Error(`DeepSeekProvider.triageChunk: ${DEAD_METHOD}`);
  }
  async mergeLessons(_input: MergeLessonsInput): Promise<CandidateLesson[]> {
    throw new Error(`DeepSeekProvider.mergeLessons: ${DEAD_METHOD}`);
  }
  async gradeAnswer(_input: GradeAnswerInput): Promise<GradeAnswerResult> {
    throw new Error(`DeepSeekProvider.gradeAnswer: ${DEAD_METHOD}`);
  }
}
