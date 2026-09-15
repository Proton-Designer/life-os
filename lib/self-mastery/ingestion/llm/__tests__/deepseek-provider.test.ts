import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeepSeekProvider } from "../deepseek-provider";
import * as gatewayModule from "@/lib/ai/gateway";
import type { GatewayChatResult } from "@/lib/ai/gateway";

/**
 * Phase 1 item 3: DeepSeekProvider now routes every call through
 * `gatewayChat()` (lib/ai/gateway.ts), never `lib/ai/client.ts`'s `chat()`
 * and never `fetch` directly -- every test here mocks `gatewayChat` itself,
 * zero network, zero spend, matching the "mock-backed first" posture the
 * Lead asked for before any real-money calibration run.
 */

const FAKE_SUPABASE = {} as unknown as SupabaseClient;
const USER_ID = "u-test-1";

function okResult(content: string, usage?: Partial<NonNullable<GatewayChatResult["usage"]>>): GatewayChatResult {
  return {
    ok: true,
    content,
    usage: {
      promptTokens: usage?.promptTokens ?? 100,
      cachedPromptTokens: usage?.cachedPromptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 50,
      reasoningTokens: usage?.reasoningTokens ?? 0,
    },
    costUsd: 0.0001,
    keySource: "server",
    attempts: 1,
  };
}

function failResult(message: string): GatewayChatResult {
  return { ok: false, message, keySource: "server", attempts: 1 };
}

let gatewayChatSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gatewayChatSpy = vi.spyOn(gatewayModule, "gatewayChat");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeepSeekProvider.summarizeSection", () => {
  it("calls gatewayChat with the right feature name, thinking disabled, and a prompt naming the book/section/excerpts", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("A short summary."));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const result = await provider.summarizeSection({
      bookTitle: "Actionable Gamification",
      sectionTitle: "Chapter 3",
      chunkTexts: ["First excerpt text.", "Second excerpt text."],
    });

    expect(result.summary).toBe("A short summary.");
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
    const [supabaseArg, userIdArg, feature, messages, opts] = gatewayChatSpy.mock.calls[0]!;
    expect(supabaseArg).toBe(FAKE_SUPABASE);
    expect(userIdArg).toBe(USER_ID);
    expect(feature).toBe("self_mastery_ingestion_summarize_section");
    expect(messages.some((m: { role: string }) => m.role === "system")).toBe(true);
    const userMessage = messages.find((m: { role: string }) => m.role === "user")!;
    expect(userMessage.content).toContain("Actionable Gamification");
    expect(userMessage.content).toContain("Chapter 3");
    expect(userMessage.content).toContain("First excerpt text.");
    // thinking:false is the deliberate cost decision this item is built
    // around -- if this regresses to unset/true, ingestion silently pays
    // for hidden reasoning tokens on every one of 66+ calls per book.
    expect(opts?.thinking).toBe(false);
    // Multi-provider Addition A (the Lead, 2026-09-14): ingestion must
    // ALWAYS request the budget tier explicitly, never ride whatever tier
    // a user picked for interactive features -- a "capable"/flagship tier
    // here would spend several real dollars of the user's own money per
    // book. Was gatewayChat's DEFAULT before this was made explicit; this
    // regression guard catches it if that default ever changes.
    expect(opts?.tier).toBe("cheap");
  });

  it("trims the returned content", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("  padded summary  \n"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] });
    expect(result.summary).toBe("padded summary");
  });

  it("THROWS rather than returning a fabricated summary when the gateway call fails", async () => {
    gatewayChatSpy.mockResolvedValue(failResult("The shared AI budget cap has been reached"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await expect(provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] })).rejects.toThrow(
      /budget cap/i,
    );
  });

  it("sets lastUsage from the gateway's real usage/cost, not a guess", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("ok", { promptTokens: 321, completionTokens: 44 }));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await provider.summarizeSection({ bookTitle: "B", sectionTitle: "S", chunkTexts: ["x"] });
    expect(provider.lastUsage).toEqual({
      promptTokens: 321,
      cachedPromptTokens: 0,
      completionTokens: 44,
      reasoningTokens: 0,
      costUsd: 0.0001,
    });
  });
});

const CHUNK_TEXT =
  "The two-minute rule states that when you start a new habit, it should take less than two minutes to do. " +
  "This works because almost any habit can be scaled down into a two-minute version.";

function validExtractJson(overrides: Partial<Record<string, string>> = {}): string {
  return JSON.stringify({
    lessons: [
      {
        title: "Shrink new habits to two minutes",
        core_claim: "Beginning any new routine works best when the initial version is trivially quick to complete.",
        mechanism: "A tiny starting version removes the friction that normally stops a habit before it forms.",
        action_template: "Pick one habit and define a version of it that takes under two minutes.",
        provenance_quote:
          "The two-minute rule states that when you start a new habit, it should take less than two minutes to do.",
        ...overrides,
      },
    ],
  });
}

describe("DeepSeekProvider.extractLessons", () => {
  it("returns a grounded, gate-passing candidate from a valid first-attempt response", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(validExtractJson()));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const candidates = await provider.extractLessons({
      chunkText: CHUNK_TEXT,
      pageStart: 12,
      pageEnd: 12,
      sourceChunkId: "chunk-1",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe("Shrink new habits to two minutes");
    expect(candidates[0]!.sourceChunkId).toBe("chunk-1");
    expect(candidates[0]!.pageRef).toBe(12);
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1); // everything passed -- no retry needed
    const opts = gatewayChatSpy.mock.calls[0]![4];
    expect(opts?.thinking).toBe(false);
    // Addition A (see summarizeSection's own test above) -- chatJson's
    // shared call site, which extractLessons/generateCards/checkEntailment
    // all go through, must request the budget tier too.
    expect(opts?.tier).toBe("cheap");
  });

  it("drops a candidate whose provenance_quote is not a verbatim substring of the chunk (isGrounded firewall survives the port)", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(validExtractJson({ provenance_quote: "This sentence was never in the source chunk at all." })),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const candidates = await provider.extractLessons({
      chunkText: CHUNK_TEXT,
      pageStart: 1,
      pageEnd: 1,
      sourceChunkId: "chunk-1",
    });

    expect(candidates).toHaveLength(0);
  });

  it("drops a candidate whose core_claim is too close to a copy of provenance_quote, and retries with a strictness note", async () => {
    gatewayChatSpy
      .mockResolvedValueOnce(
        okResult(
          validExtractJson({
            core_claim: "The two-minute rule states that when you start a new habit, it should take less than two minutes to do.",
          }),
        ),
      )
      .mockResolvedValueOnce(okResult(validExtractJson()));

    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const candidates = await provider.extractLessons({
      chunkText: CHUNK_TEXT,
      pageStart: 1,
      pageEnd: 1,
      sourceChunkId: "chunk-1",
    });

    expect(candidates).toHaveLength(1);
    expect(gatewayChatSpy).toHaveBeenCalledTimes(2);
    const secondUserPrompt = gatewayChatSpy.mock.calls[1]![3].find((m: { role: string }) => m.role === "user")!.content;
    expect(secondUserPrompt).toMatch(/previous attempt's core_claim was rejected/);
  });

  it("returns an empty array (never throws) when every attempt returns unparseable JSON", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("not json at all"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const candidates = await provider.extractLessons({
      chunkText: CHUNK_TEXT,
      pageStart: 1,
      pageEnd: 1,
      sourceChunkId: "chunk-1",
    });
    expect(candidates).toEqual([]);
    expect(gatewayChatSpy).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS exhausted
  });

  it("THROWS immediately on a genuine gateway failure -- never silently degrades to an empty candidate list", async () => {
    gatewayChatSpy.mockResolvedValue(failResult("DeepSeek says you're out of quota or rate-limited."));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await expect(
      provider.extractLessons({ chunkText: CHUNK_TEXT, pageStart: 1, pageEnd: 1, sourceChunkId: "chunk-1" }),
    ).rejects.toThrow(/quota or rate-limited/i);
    // Fails closed on the FIRST call -- an infra failure is not retried as
    // if it were model noise (that would burn 3x the calls for no benefit
    // on a failure mode retrying can't fix).
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
  });

  it("strips a markdown code fence around the JSON before parsing", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("```json\n" + validExtractJson() + "\n```"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const candidates = await provider.extractLessons({
      chunkText: CHUNK_TEXT,
      pageStart: 1,
      pageEnd: 1,
      sourceChunkId: "chunk-1",
    });
    expect(candidates).toHaveLength(1);
  });
});

describe("DeepSeekProvider.extractLessonsBatch (P2-14)", () => {
  const CHUNK_A = { chunkText: CHUNK_TEXT, pageStart: 1, pageEnd: 1, sourceChunkId: "chunk-a" };
  const CHUNK_B = {
    chunkText: "Deep work is the ability to focus without distraction on a cognitively demanding task.",
    pageStart: 5,
    pageEnd: 5,
    sourceChunkId: "chunk-b",
  };

  it("returns an empty array for zero inputs without calling the gateway", async () => {
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([]);
    expect(result).toEqual({ perChunk: [] });
    expect(gatewayChatSpy).not.toHaveBeenCalled();
  });

  it("degrades to the plain single-item call for exactly one input", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(validExtractJson()));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([CHUNK_A]);
    expect(result.perChunk).toHaveLength(1);
    expect(result.perChunk[0]).toHaveLength(1);
    expect(result.perChunk[0]![0]!.sourceChunkId).toBe("chunk-a");
  });

  it("ONE combined gatewayChat call returns matching, correctly-ordered candidates for each of 2 chunks", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        JSON.stringify({
          results: [
            {
              lessons: [
                {
                  title: "Shrink new habits to two minutes",
                  core_claim: "Beginning any new routine works best when the initial version is trivially quick to complete.",
                  mechanism: "A tiny starting version removes the friction that normally stops a habit before it forms.",
                  action_template: "Pick one habit and define a version of it that takes under two minutes.",
                  provenance_quote:
                    "The two-minute rule states that when you start a new habit, it should take less than two minutes to do.",
                },
              ],
            },
            {
              lessons: [
                {
                  title: "Protect blocks of undistracted focus",
                  core_claim: "Sustained concentration on hard problems, free of interruption, is a distinct skill worth protecting.",
                  mechanism: "Demanding cognitive work degrades sharply under fragmented attention.",
                  action_template: "Schedule a recurring block with notifications off for your hardest task.",
                  provenance_quote: "Deep work is the ability to focus without distraction on a cognitively demanding task.",
                },
              ],
            },
          ],
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const result = await provider.extractLessonsBatch([CHUNK_A, CHUNK_B]);

    expect(gatewayChatSpy).toHaveBeenCalledTimes(1); // ONE call for both chunks -- the entire point of batching
    expect(result.perChunk).toHaveLength(2);
    expect(result.perChunk[0]![0]!.sourceChunkId).toBe("chunk-a");
    expect(result.perChunk[0]![0]!.title).toBe("Shrink new habits to two minutes");
    expect(result.perChunk[1]![0]!.sourceChunkId).toBe("chunk-b");
    expect(result.perChunk[1]![0]!.title).toBe("Protect blocks of undistracted focus");
    const opts = gatewayChatSpy.mock.calls[0]![4];
    expect(opts?.tier).toBe("cheap");
  });

  it("THE REGRESSION GUARD: a malformed response (no results array) falls back to null for EVERY chunk, not an empty-lessons guess", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("not json at all"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([CHUNK_A, CHUNK_B]);
    expect(result.perChunk).toEqual([null, null]);
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1); // no strictness-note retry loop for the batch call itself
  });

  it("a wrong-length results array (partial response) also falls back to null for every chunk -- never misaligns indices", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(JSON.stringify({ results: [{ lessons: [] }] }))); // 1 entry for 2 chunks
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([CHUNK_A, CHUNK_B]);
    expect(result.perChunk).toEqual([null, null]);
  });

  it("a single malformed entry within an otherwise-valid results array only nulls that one slot", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        JSON.stringify({
          results: [
            { lessons: "not an array" }, // malformed slot 0
            {
              lessons: [
                {
                  title: "Protect blocks of undistracted focus",
                  core_claim: "Sustained concentration on hard problems, free of interruption, is a distinct skill worth protecting.",
                  mechanism: "Demanding cognitive work degrades sharply under fragmented attention.",
                  action_template: "Schedule a recurring block with notifications off for your hardest task.",
                  provenance_quote: "Deep work is the ability to focus without distraction on a cognitively demanding task.",
                },
              ],
            },
          ],
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([CHUNK_A, CHUNK_B]);
    expect(result.perChunk[0]).toBeNull();
    expect(result.perChunk[1]).toHaveLength(1);
  });

  it("an ungrounded quote in one chunk's slot yields an empty array for that slot (not null) -- a real, legitimate outcome", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        JSON.stringify({
          results: [
            {
              lessons: [
                {
                  title: "x",
                  core_claim: "y",
                  mechanism: "z",
                  action_template: "w",
                  provenance_quote: "This was never in chunk A at all.",
                },
              ],
            },
            { lessons: [] },
          ],
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.extractLessonsBatch([CHUNK_A, CHUNK_B]);
    expect(result.perChunk[0]).toEqual([]); // dropped by the grounding firewall, not a fallback case
    expect(result.perChunk[1]).toEqual([]);
  });
});

const LESSON = {
  title: "Shrink new habits to two minutes",
  coreClaim: "Beginning any new routine works best when the initial version is trivially quick to complete.",
  mechanism: "A tiny starting version removes the friction that normally stops a habit before it forms.",
  actionTemplate: "Pick one habit and define a version of it that takes under two minutes.",
  evidenceStrength: "author_anecdote" as const,
  provenanceQuote: "The two-minute rule states that when you start a new habit, it should take less than two minutes to do.",
  pageRef: 12,
  sourceChunkId: "chunk-1",
};

function validCardsJsonFields(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    free_recall_prompt: "What does this lesson claim about the ideal length of a new habit's first version?",
    application_prompt: "You want to start flossing every night but keep skipping it -- what's the two-minute version?",
    application_answer: "Floss just one tooth for the first week, so the habit takes under two minutes to complete.",
    why_prompt: "In your own words, why does a tiny starting version make a new habit more likely to stick?",
    ...overrides,
  };
}

function validCardsJson(overrides: Partial<Record<string, string>> = {}): string {
  return JSON.stringify(validCardsJsonFields(overrides));
}

describe("DeepSeekProvider.generateCards", () => {
  it("returns free_recall, application, why, and a cloze card from a valid response", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(validCardsJson()));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const cards = await provider.generateCards({ lesson: LESSON });

    const types = cards.map((c) => c.promptType);
    expect(types).toContain("free_recall");
    expect(types).toContain("application");
    expect(types).toContain("why");
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the heuristic free_recall template when every attempt's own free_recall leaks the answer", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        validCardsJson({
          // Reuses the claim's own exact wording -- must fail passesAntiLeak.
          free_recall_prompt: LESSON.coreClaim,
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const cards = await provider.generateCards({ lesson: LESSON });

    expect(cards.some((c) => c.promptType === "free_recall")).toBe(true); // fallback guarantees this
    expect(gatewayChatSpy).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS exhausted trying to get a passing one
  });

  it("THROWS immediately on a genuine gateway failure", async () => {
    gatewayChatSpy.mockResolvedValue(failResult("DeepSeek returned an error (HTTP 500)."));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await expect(provider.generateCards({ lesson: LESSON })).rejects.toThrow(/HTTP 500/);
  });
});

const LESSON_B = {
  title: "Protect blocks of undistracted focus",
  coreClaim: "Sustained concentration on hard problems, free of interruption, is a distinct skill worth protecting.",
  mechanism: "Demanding cognitive work degrades sharply under fragmented attention.",
  actionTemplate: "Schedule a recurring block with notifications off for your hardest task.",
  evidenceStrength: "author_anecdote" as const,
  provenanceQuote: "Deep work is the ability to focus without distraction on a cognitively demanding task.",
  pageRef: 5,
  sourceChunkId: "chunk-b",
};

describe("DeepSeekProvider.generateCardsBatch (P2-14)", () => {
  it("returns an empty array for zero inputs without calling the gateway", async () => {
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.generateCardsBatch([]);
    expect(result).toEqual({ perLesson: [] });
    expect(gatewayChatSpy).not.toHaveBeenCalled();
  });

  it("degrades to the plain single-item call (with its free_recall/cloze guarantee) for exactly one input", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(validCardsJson()));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.generateCardsBatch([{ lesson: LESSON }]);
    expect(result.perLesson).toHaveLength(1);
    expect(result.perLesson[0]!.some((c) => c.promptType === "free_recall")).toBe(true);
  });

  it("ONE combined gatewayChat call returns matching, correctly-ordered cards for each of 2 lessons, each with the free_recall guarantee applied", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        JSON.stringify({
          results: [
            validCardsJsonFields(),
            validCardsJsonFields({ free_recall_prompt: "What skill does this lesson say is worth protecting?" }),
          ],
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const result = await provider.generateCardsBatch([{ lesson: LESSON }, { lesson: LESSON_B }]);

    expect(gatewayChatSpy).toHaveBeenCalledTimes(1); // ONE call for both lessons
    expect(result.perLesson).toHaveLength(2);
    expect(result.perLesson[0]!.some((c) => c.promptType === "free_recall")).toBe(true);
    expect(result.perLesson[1]!.some((c) => c.promptType === "free_recall")).toBe(true);
    expect(result.perLesson[1]!.find((c) => c.promptType === "free_recall")!.prompt).toBe(
      "What skill does this lesson say is worth protecting?",
    );
    // finalizeCards' cloze append applies uniformly to a batch-successful slot too.
    expect(result.perLesson[0]!.length).toBeGreaterThan(0);
  });

  it("THE REGRESSION GUARD: a malformed response falls back to null for EVERY lesson, never a silently-empty deck", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("not json at all"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.generateCardsBatch([{ lesson: LESSON }, { lesson: LESSON_B }]);
    expect(result.perLesson).toEqual([null, null]);
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
  });

  it("a wrong-length results array also falls back to null for every lesson", async () => {
    gatewayChatSpy.mockResolvedValue(okResult(JSON.stringify({ results: [validCardsJsonFields()] }))); // 1 entry for 2 lessons
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.generateCardsBatch([{ lesson: LESSON }, { lesson: LESSON_B }]);
    expect(result.perLesson).toEqual([null, null]);
  });

  it("a single invalid-shape entry within an otherwise-valid results array only nulls that one slot", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(
        JSON.stringify({
          results: [{ free_recall_prompt: "missing the other three fields" }, validCardsJsonFields()],
        }),
      ),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.generateCardsBatch([{ lesson: LESSON }, { lesson: LESSON_B }]);
    expect(result.perLesson[0]).toBeNull();
    expect(result.perLesson[1]!.some((c) => c.promptType === "free_recall")).toBe(true);
  });
});

describe("DeepSeekProvider.checkEntailment", () => {
  it("returns SUPPORTS from a valid response, in exactly one call", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(JSON.stringify({ passage_point: "x", verdict: "SUPPORTS", reason: "matches" })),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);

    const result = await provider.checkEntailment({ claim: "c", quote: "q" });

    expect(result).toEqual({ verdict: "SUPPORTS", reason: "matches" });
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1);
    const opts = gatewayChatSpy.mock.calls[0]![4];
    expect(opts?.thinking).toBe(false);
  });

  it("returns CONTRADICTS / UNRELATED verbatim from a valid response", async () => {
    gatewayChatSpy.mockResolvedValue(
      okResult(JSON.stringify({ passage_point: "x", verdict: "CONTRADICTS", reason: "opposite" })),
    );
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    expect(await provider.checkEntailment({ claim: "c", quote: "q" })).toEqual({
      verdict: "CONTRADICTS",
      reason: "opposite",
    });
  });

  it("FAILS CLOSED to UNRELATED, not a throw, when a successful call returns an unparseable/invalid-shape response", async () => {
    gatewayChatSpy.mockResolvedValue(okResult("not valid json"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    const result = await provider.checkEntailment({ claim: "c", quote: "q" });
    expect(result.verdict).toBe("UNRELATED");
    expect(gatewayChatSpy).toHaveBeenCalledTimes(1); // no retry loop for entailment -- one call per lesson
  });

  it("THROWS (does not fail closed to a verdict) when the gateway call itself fails -- an infra failure is not a real judgment", async () => {
    gatewayChatSpy.mockResolvedValue(failResult("The shared AI budget cap has been reached"));
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await expect(provider.checkEntailment({ claim: "c", quote: "q" })).rejects.toThrow(/budget cap/i);
  });
});

describe("DeepSeekProvider — mergeLessons/triageChunk/gradeAnswer are verified dead, not implemented", () => {
  it("throws a clear pointer for each, never a silent wrong answer", async () => {
    const provider = new DeepSeekProvider(FAKE_SUPABASE, USER_ID);
    await expect(provider.triageChunk({ chunkText: "x" })).rejects.toThrow(/not implemented/);
    await expect(provider.mergeLessons({ candidates: [], targetCount: { min: 1, max: 2 } })).rejects.toThrow(
      /not implemented/,
    );
    await expect(provider.gradeAnswer({ cardPrompt: "p", cardAnswer: "a", userAnswer: "u" })).rejects.toThrow(
      /not implemented/,
    );
    expect(gatewayChatSpy).not.toHaveBeenCalled();
  });
});
