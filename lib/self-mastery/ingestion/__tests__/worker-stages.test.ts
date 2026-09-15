import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * R43: the entailment stage must fail closed, not degrade-and-annotate,
 * when no real provider is available. This is the regression test for
 * that reversal — the FIRST version of worker-stages.ts fell back to
 * HeuristicProvider and recorded a normal success; this suite proves the
 * current version refuses to.
 *
 * PHASE 1 ITEM 3 UPDATE: `resolveIngestionProvider()` (worker-stages.ts) no
 * longer throws a "no real provider available" error itself when
 * `DevShimProvider.fromEnv()` returns null -- it falls through to a real,
 * gateway-routed `DeepSeekProvider` instead (absence, not a guarded
 * presence, same as `DevShimProvider.fromEnv()`'s own null-in-production
 * behavior). The fail-closed OUTCOME this suite exists to prove is
 * unchanged -- a chunk/lesson still can't silently "pass" without a real
 * provider actually running a check -- but the MECHANISM moved: it is now
 * `DeepSeekProvider`'s own call, through `gatewayChat`, failing closed (no
 * key / spend cap / provider error -> throws), not a pre-flight
 * `if (!provider)` check here. `gatewayChat` is mocked below so these tests
 * can force that failure deterministically, without depending on any real
 * env var being unset or a real network call.
 */

vi.mock("../llm/dev-shim-provider", () => ({
  DevShimProvider: { fromEnv: vi.fn() },
}));

vi.mock("@/lib/ai/gateway", () => ({
  gatewayChat: vi.fn(),
}));

const getUserEmbeddingsMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  getUserEmbeddings: (...args: unknown[]) => getUserEmbeddingsMock(...args),
}));

function makeSupabaseWithLessons(
  lessons: { id: string; core_claim: string | null; provenance_quote: string }[],
  notSpy?: (column: string, operator: string, value: unknown) => void,
  onUpdate?: (vals: Record<string, unknown>, eqCalls: [string, unknown][]) => void,
) {
  return {
    from(table: string) {
      if (table !== "lessons") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                not(column: string, operator: string, value: unknown) {
                  notSpy?.(column, operator, value);
                  return {
                    order: async () => ({ data: lessons, error: null }),
                  };
                },
              };
            },
          };
        },
        update(vals: Record<string, unknown>) {
          const eqCalls: [string, unknown][] = [];
          const builder = {
            eq(col: string, val: unknown) {
              eqCalls.push([col, val]);
              return builder;
            },
            then(resolve: (v: { error: null }) => void) {
              onUpdate?.(vals, eqCalls);
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

describe("verifying_grounding stage — fail-closed on no real provider (R43)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("THROWS when DevShimProvider.fromEnv() returns null AND the DeepSeekProvider fallback's own gateway call fails -- no marked pass either way", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "claim", provenance_quote: "quote" }]);

    await expect(
      STAGE_HANDLERS.verifying_grounding!({
        job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/gateway call failed/);
  });

  it("does NOT call checkEntailment at all when no provider is available -- the refusal happens before any check attempt", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const checkEntailment = vi.fn();
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "claim", provenance_quote: "quote" }]);

    await expect(
      STAGE_HANDLERS.verifying_grounding!({ job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never, supabase: supabase as never }),
    ).rejects.toThrow();
    expect(checkEntailment).not.toHaveBeenCalled();
  });

  it("GREEN: with a real provider available, calls checkEntailment and threads its real token usage through", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const fakeProvider = {
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "SUPPORTS", reason: "matches" }),
      lastUsage: { promptTokens: 7443, completionTokens: 211 },
    };
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(fakeProvider as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "claim text", provenance_quote: "quote text" }]);

    const result = await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(fakeProvider.checkEntailment).toHaveBeenCalledWith({ claim: "claim text", quote: "quote text" });
    expect(result.tokensIn).toBe(7443);
    expect(result.tokensOut).toBe(211);
    expect(result.nextStage).toBe("verifying_grounding");
    expect(result.nextChunkIndex).toBe(1);
  });

  it("advances to generating_cards (whole-book, chunk_index null) once all lessons for the book are checked", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "SUPPORTS", reason: "matches" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "c", provenance_quote: "q" }]); // only 1 lesson

    // chunk_index=1 is past the single lesson at index 0 -- MAP is exhausted.
    const result = await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 1 } as never,
      supabase: supabase as never,
    });

    expect(result.nextStage).toBe("generating_cards");
    expect(result.nextChunkIndex).toBeNull();
  });

  it("REGRESSION: queries only rank-is-not-null lessons -- without this, every archived (non-merge-selected) candidate gets entailment-checked too, wrong spend and a wrong denominator for item 7's drop-rate prediction", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "SUPPORTS", reason: "matches" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const notCalls: [string, string, unknown][] = [];
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "c", provenance_quote: "q" }], (col, op, val) =>
      notCalls.push([col, op, val]),
    );

    await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(notCalls).toEqual([["rank", "is", null]]);
  });

  it("item 7: a SUPPORTS verdict does NOT touch the lessons row -- no update call at all", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "SUPPORTS", reason: "matches" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let updateCalled = false;
    const supabase = makeSupabaseWithLessons(
      [{ id: "l1", core_claim: "c", provenance_quote: "q" }],
      undefined,
      () => (updateCalled = true),
    );

    const result = await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(updateCalled).toBe(false);
    expect(result.nextChunkIndex).toBe(1);
  });

  it("item 7: a CONTRADICTS verdict rejects the lesson -- status:'rejected', rank:null, scoped to status='archived' on the way out", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "CONTRADICTS", reason: "the quote says the opposite" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let updateVals: Record<string, unknown> | null = null;
    let updateEqCalls: [string, unknown][] = [];
    const supabase = makeSupabaseWithLessons(
      [{ id: "l1", core_claim: "c", provenance_quote: "q" }],
      undefined,
      (vals, eqCalls) => {
        updateVals = vals;
        updateEqCalls = eqCalls;
      },
    );

    const result = await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(updateVals).toEqual({ status: "rejected", rank: null });
    expect(updateEqCalls).toEqual([
      ["id", "l1"],
      ["status", "archived"],
    ]);
    // The stage still advances -- the CHECK succeeded (it correctly found a
    // problem); only the lesson's own fate changes, not the MAP loop.
    expect(result.nextStage).toBe("verifying_grounding");
    expect(result.nextChunkIndex).toBe(1);
  });

  it("item 7: an UNRELATED verdict ALSO rejects the lesson -- same database action as CONTRADICTS, never silently kept", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "UNRELATED", reason: "the quote doesn't establish the claim" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let updateVals: Record<string, unknown> | null = null;
    const supabase = makeSupabaseWithLessons(
      [{ id: "l1", core_claim: "c", provenance_quote: "q" }],
      undefined,
      (vals) => (updateVals = vals),
    );

    await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(updateVals).toEqual({ status: "rejected", rank: null });
  });

  it("item 7: CONTRADICTS logs at a higher severity (console.error) than UNRELATED (console.warn) -- not the same severity even though the DB action is identical", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "CONTRADICTS", reason: "opposite" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);
    await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: makeSupabaseWithLessons([{ id: "l1", core_claim: "c", provenance_quote: "q" }]) as never,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockClear();
    warnSpy.mockClear();

    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockResolvedValue({ verdict: "UNRELATED", reason: "unrelated" }),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);
    await STAGE_HANDLERS.verifying_grounding!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: makeSupabaseWithLessons([{ id: "l1", core_claim: "c", provenance_quote: "q" }]) as never,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("item 7: checkEntailment throwing (the check itself failing) propagates -- fails closed, does NOT reject or advance the lesson", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      checkEntailment: vi.fn().mockRejectedValue(new Error("shim timed out")),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let updateCalled = false;
    const supabase = makeSupabaseWithLessons(
      [{ id: "l1", core_claim: "c", provenance_quote: "q" }],
      undefined,
      () => (updateCalled = true),
    );

    await expect(
      STAGE_HANDLERS.verifying_grounding!({
        job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/shim timed out/);

    expect(updateCalled).toBe(false);
  });
});

describe("extracting_lessons stage — fail-closed on no real provider, idempotent per-chunk writes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeSupabase(opts: {
    chunk: { id: string; text: string; page_start: number; page_end: number; section_id?: string | null } | null;
    onDelete?: (eqCalls: [string, unknown][]) => void;
    onInsert?: (rows: unknown[]) => void;
  }) {
    return {
      from(table: string) {
        if (table === "source_chunks") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        range() {
                          return { maybeSingle: async () => ({ data: opts.chunk, error: null }) };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "lessons") {
          return {
            delete() {
              const eqCalls: [string, unknown][] = [];
              const builder = {
                eq(col: string, val: unknown) {
                  eqCalls.push([col, val]);
                  return builder;
                },
                then(resolve: (v: { error: null }) => void) {
                  opts.onDelete?.(eqCalls);
                  resolve({ error: null });
                },
              };
              return builder;
            },
            insert: async (rows: unknown[]) => {
              opts.onInsert?.(rows);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  it("throws when DevShimProvider.fromEnv() returns null AND the DeepSeekProvider fallback's own gateway call fails -- no HeuristicProvider fallback either way", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ chunk: { id: "c1", text: "some passage", page_start: 1, page_end: 1 } });

    await expect(
      STAGE_HANDLERS.extracting_lessons!({
        job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/gateway call failed/);
  });

  it("advances to merging (whole-book) once every source_chunks row has been offered", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ extractLessons: vi.fn() } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ chunk: null }); // range() past the last chunk

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 5 } as never,
      supabase: supabase as never,
    });

    expect(result.nextStage).toBe("merging");
    expect(result.nextChunkIndex).toBeNull();
  });

  it("idempotent write: deletes this chunk's prior archived candidates (scoped by source_chunk_id AND status) before inserting the fresh set, and tags extracted_by:'model'", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const candidate = {
      title: "t",
      coreClaim: "claim",
      mechanism: "mech",
      actionTemplate: "act",
      evidenceStrength: "author_anecdote" as const,
      provenanceQuote: "quote",
      pageRef: 3,
      sourceChunkId: "c1",
    };
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      extractLessons: vi.fn().mockResolvedValue([candidate]),
      lastUsage: { promptTokens: 500, completionTokens: 80 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let deleteEqCalls: [string, unknown][] = [];
    let insertedRows: unknown[] = [];
    const supabase = makeSupabase({
      chunk: { id: "c1", text: "passage text", page_start: 3, page_end: 3 },
      onDelete: (calls) => (deleteEqCalls = calls),
      onInsert: (rows) => (insertedRows = rows),
    });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(deleteEqCalls).toEqual([
      ["source_chunk_id", "c1"],
      ["status", "archived"],
    ]);
    expect(insertedRows).toHaveLength(1);
    expect((insertedRows[0] as Record<string, unknown>)["status"]).toBe("archived");
    expect((insertedRows[0] as Record<string, unknown>)["extracted_by"]).toBe("model");
    expect((insertedRows[0] as Record<string, unknown>)["rank"]).toBeUndefined(); // rank is merging's job, not extraction's
    expect(result.nextStage).toBe("extracting_lessons");
    expect(result.nextChunkIndex).toBe(1);
    expect(result.tokensIn).toBe(500);
    expect(result.tokensOut).toBe(80);
  });

  it("item 8: threads the chunk's section_id onto every lesson extracted from it -- chunkingStage already writes it, this stage just wasn't reading it back", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const candidate = {
      title: "t",
      coreClaim: "claim",
      mechanism: "mech",
      actionTemplate: "act",
      evidenceStrength: "author_anecdote" as const,
      provenanceQuote: "quote",
      pageRef: 3,
      sourceChunkId: "c1",
    };
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      extractLessons: vi.fn().mockResolvedValue([candidate]),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let insertedRows: unknown[] = [];
    const supabase = makeSupabase({
      chunk: { id: "c1", text: "passage text", page_start: 3, page_end: 3, section_id: "section-42" },
      onInsert: (rows) => (insertedRows = rows),
    });

    await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(insertedRows).toHaveLength(1);
    expect((insertedRows[0] as Record<string, unknown>)["section_id"]).toBe("section-42");
  });

  it("item 8: a chunk with no detected section (section_id: null) writes null, not a guessed value", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    const candidate = {
      title: "t",
      coreClaim: "claim",
      mechanism: "mech",
      actionTemplate: "act",
      evidenceStrength: "author_anecdote" as const,
      provenanceQuote: "quote",
      pageRef: 3,
      sourceChunkId: "c1",
    };
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      extractLessons: vi.fn().mockResolvedValue([candidate]),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let insertedRows: unknown[] = [];
    const supabase = makeSupabase({
      chunk: { id: "c1", text: "passage text", page_start: 3, page_end: 3, section_id: null },
      onInsert: (rows) => (insertedRows = rows),
    });

    await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect((insertedRows[0] as Record<string, unknown>)["section_id"]).toBeNull();
  });
});

describe("generating_cards stage — fail-closed on no real provider, per-lesson promotion (D-018)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeSupabase(opts: {
    lesson: Record<string, unknown> | null;
    onCardsInsert?: (rows: unknown[]) => void;
    onPromote?: (status: string) => void;
    onCardStatesInsert?: (rows: unknown[]) => void;
    /** Lets a test simulate the real DB refusing this insert (e.g. the R43-style
     * "prove the test has teeth" break -- see this file's own header on why every
     * assertion here is checked RED before it is trusted GREEN). */
    cardStatesInsertError?: { message: string } | null;
  }) {
    // Fabricated ids, distinct per row -- the fix reads THESE back off the
    // `cards` insert's own `.select("id")` response and must use exactly
    // them (not the lesson id, not a placeholder) when building card_states
    // rows, so a test asserting the wrong id would still catch a real bug.
    let nextCardId = 0;
    return {
      from(table: string) {
        if (table === "lessons") {
          return {
            select() {
              return {
                eq() {
                  return {
                    not() {
                      return {
                        order() {
                          return {
                            range() {
                              return { maybeSingle: async () => ({ data: opts.lesson, error: null }) };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
            update(vals: { status?: string }) {
              const builder = {
                eq() {
                  return builder;
                },
                then(resolve: (v: { error: null }) => void) {
                  if (vals.status) opts.onPromote?.(vals.status);
                  resolve({ error: null });
                },
              };
              return builder;
            },
          };
        }
        if (table === "cards") {
          return {
            delete() {
              return { eq: async () => ({ error: null }) };
            },
            insert(rows: unknown[]) {
              opts.onCardsInsert?.(rows);
              const inserted = rows.map(() => ({ id: `card-${nextCardId++}` }));
              return {
                select: async () => ({ data: inserted, error: null }),
              };
            },
          };
        }
        if (table === "card_states") {
          return {
            insert: async (rows: unknown[]) => {
              opts.onCardStatesInsert?.(rows);
              return { error: opts.cardStatesInsertError ?? null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  const LESSON = {
    id: "l1",
    title: "t",
    core_claim: "claim",
    mechanism: "mech",
    action_template: "act",
    evidence_strength: "author_anecdote",
    provenance_quote: "quote",
    page_ref: 1,
    source_chunk_id: "c1",
  };

  it("throws when DevShimProvider.fromEnv() returns null AND the DeepSeekProvider fallback's own gateway call fails -- no HeuristicProvider fallback either way", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockResolvedValue({ ok: false, message: "AI features aren't enabled for this account." });

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ lesson: LESSON });

    await expect(
      STAGE_HANDLERS.generating_cards!({
        job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/gateway call failed/);
  });

  it("advances to finalizing (whole-book) once every rank-ordered lesson has been offered", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ generateCards: vi.fn() } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ lesson: null });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 3 } as never,
      supabase: supabase as never,
    });

    expect(result.nextStage).toBe("finalizing");
    expect(result.nextChunkIndex).toBeNull();
  });

  it("D-018: promotes to status:'active' when at least one card survives", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([{ promptType: "free_recall", prompt: "p", answer: "a" }]),
      lastUsage: { promptTokens: 10, completionTokens: 5 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let promoted: string | null = null;
    const supabase = makeSupabase({ lesson: LESSON, onPromote: (status) => (promoted = status) });

    await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(promoted).toBe("active");
  });

  it("D-018: does NOT promote when zero cards survive -- lesson stays at its pre-promotion (archived) status", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([]),
      lastUsage: { promptTokens: 10, completionTokens: 5 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let promoteCalled = false;
    const supabase = makeSupabase({ lesson: LESSON, onPromote: () => (promoteCalled = true) });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(promoteCalled).toBe(false);
    expect(result.nextStage).toBe("generating_cards");
    expect(result.nextChunkIndex).toBe(1);
  });

  /**
   * POST-DEPLOY FINDING: a real-ingested card with no `card_states` row is
   * permanently invisible to `get_session_queue` (both its arms, 071/126,
   * select FROM card_states, never from cards) -- readable as lesson
   * content, never reachable as something to study. `seed_meditations_deck`
   * (103) always wrote this row for its seeded decks; the real pipeline
   * never did, for any book, ever. This is the regression test for that gap
   * -- it asserts the SCHEDULER row exists with the right shape, not merely
   * that `cards` rows appear. A test checking only "cards were inserted"
   * would have passed against this exact bug for as long as the bug
   * existed; that is the assertion this test is written to NOT be.
   *
   * A test asserting a real behaviour must be provably able to fail. This
   * one was: with the fix's `card_states` insert commented out in
   * worker-stages.ts, this exact test failed with
   * `expected undefined to deeply equal [...]` (no insert call was ever
   * made to `card_states`, so `capturedRows` stayed unset) -- confirmed RED
   * before the insert was restored and this suite re-run GREEN.
   */
  it("creates a card_states row for every surviving card, mirroring migration 103's column set exactly (card_id, user_id, book_id, state:'new') -- the fix for the post-deploy 'ingested books are unstudyable' finding", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([
        { promptType: "free_recall", prompt: "p1", answer: "a1" },
        { promptType: "free_recall", prompt: "p2", answer: "a2" },
      ]),
      lastUsage: { promptTokens: 10, completionTokens: 5 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let capturedRows: unknown[] | undefined;
    const supabase = makeSupabase({
      lesson: LESSON,
      onCardStatesInsert: (rows) => (capturedRows = rows),
    });

    await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-42", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    // Exactly one card_states row per surviving card, keyed to the REAL ids
    // the cards insert returned -- not the lesson id, not a shared
    // placeholder, and `user_id` is the JOB'S owner (ctx.job.user_id), not
    // the cards table's zero-UUID trigger placeholder: card_states' own
    // trigger (card_states_derive_and_check, 070) does not overwrite
    // user_id under a service-role caller, it VALIDATES the supplied value
    // against the card's real owner -- a wrong id here would fail closed
    // against the real database, and this test would not catch that unless
    // it checks the exact value, not just that "some insert happened".
    expect(capturedRows).toEqual([
      { card_id: "card-0", user_id: "owner-42", book_id: "book-1", state: "new" },
      { card_id: "card-1", user_id: "owner-42", book_id: "book-1", state: "new" },
    ]);
  });

  it("does NOT insert into card_states when zero cards survive -- nothing to schedule for a lesson with no cards", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([]),
      lastUsage: { promptTokens: 10, completionTokens: 5 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let cardStatesInsertCalled = false;
    const supabase = makeSupabase({
      lesson: LESSON,
      onCardStatesInsert: () => (cardStatesInsertCalled = true),
    });

    await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-42", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(cardStatesInsertCalled).toBe(false);
  });

  it("throws (fails closed, does not swallow) when the card_states insert itself fails -- same posture as every other write in this stage", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([{ promptType: "free_recall", prompt: "p", answer: "a" }]),
      lastUsage: { promptTokens: 10, completionTokens: 5 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({
      lesson: LESSON,
      cardStatesInsertError: { message: "duplicate key value violates unique constraint \"card_states_card_user_key\"" },
    });

    await expect(
      STAGE_HANDLERS.generating_cards!({
        job: { id: "job-1", book_id: "book-1", user_id: "owner-42", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/card_states_card_user_key/);
  });
});

/**
 * P2-13: `mergingStage` now passes a real `Embedder` (lib/ai/embeddings.ts's
 * `getUserEmbeddings`) into `HeuristicProvider` instead of always
 * constructing one with no `embed` at all. `getUserEmbeddings` itself is
 * mocked (it has its own full unit-test suite, lib/ai/__tests__/embeddings.test.ts)
 * -- these tests only prove the WIRING: the right user id reaches it, and a
 * failure of ANY kind degrades to the pipeline's pre-existing embedding-less
 * behavior (empty vectors) rather than throwing and failing the whole
 * ingestion job.
 */
describe("merging stage — P2-13 embedder wiring", () => {
  function makeMergingSupabase(
    lessons: { id: string; title: string; core_claim: string | null; mechanism: string | null; action_template: string | null; evidence_strength: string | null; provenance_quote: string; page_ref: number | null; source_chunk_id: string | null }[],
    pageCount = 80,
  ) {
    const rankUpdates: { id: string; rank: number | null }[] = [];
    const supabase = {
      from(table: string) {
        if (table === "books") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { page_count: pageCount }, error: null }) }) }) };
        }
        if (table === "lessons") {
          return {
            update(vals: Record<string, unknown>) {
              const builder = {
                eq(col: string, val: unknown) {
                  if (col === "id") rankUpdates.push({ id: val as string, rank: vals.rank as number | null });
                  return builder;
                },
                then(resolve: (v: { error: null }) => void) {
                  resolve({ error: null });
                },
              };
              return builder;
            },
            select() {
              return { eq: () => ({ eq: async () => ({ data: lessons, error: null }) }) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { supabase, rankUpdates };
  }

  function lesson(id: string, claim: string) {
    return {
      id,
      title: claim,
      core_claim: claim,
      mechanism: "because reasons",
      action_template: "try this",
      evidence_strength: "single_study",
      provenance_quote: `"${claim}" -- p.1`,
      page_ref: 1,
      source_chunk_id: "chunk-1",
    };
  }

  beforeEach(() => {
    getUserEmbeddingsMock.mockReset();
  });

  it("calls getUserEmbeddings with this job's own user id", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "no_key" });
    const { supabase } = makeMergingSupabase([lesson("l1", "Claim one"), lesson("l2", "Claim two")]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    await STAGE_HANDLERS.merging!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-77", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(getUserEmbeddingsMock).toHaveBeenCalled();
    const call = getUserEmbeddingsMock.mock.calls[0]!;
    expect(call[1]).toBe("owner-77");
  });

  it("status: no_key degrades to empty vectors, and the stage still completes (ranks assigned, no throw) -- the pre-existing embedding-less behavior, unchanged", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "no_key" });
    const { supabase, rankUpdates } = makeMergingSupabase([lesson("l1", "Claim one"), lesson("l2", "Claim two")]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.merging!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(result.nextStage).toBe("verifying_grounding");
    expect(rankUpdates.map((r) => r.id).sort()).toEqual(["l1", "l2"]);
  });

  it("a provider error (status: unavailable) ALSO degrades gracefully rather than failing the whole merging stage -- an ingestion job must not hard-fail on a transient embeddings problem", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "unavailable", message: "OpenAI rejected that key." });
    const { supabase, rankUpdates } = makeMergingSupabase([lesson("l1", "Claim one"), lesson("l2", "Claim two")]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.merging!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(result.nextStage).toBe("verifying_grounding");
    expect(rankUpdates.length).toBeGreaterThan(0);
  });

  it("a successful embedding result feeds real vectors through -- both survivors still get ranked", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "ok", provider: "openai", embeddings: [[1, 0], [0, 1]] });
    const { supabase, rankUpdates } = makeMergingSupabase([lesson("l1", "Claim one"), lesson("l2", "Claim two")]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    await STAGE_HANDLERS.merging!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(rankUpdates.map((r) => r.id).sort()).toEqual(["l1", "l2"]);
  });
});
