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
 * gateway-routed `GatewayLlmProvider` instead (absence, not a guarded
 * presence, same as `DevShimProvider.fromEnv()`'s own null-in-production
 * behavior). The fail-closed OUTCOME this suite exists to prove is
 * unchanged -- a chunk/lesson still can't silently "pass" without a real
 * provider actually running a check -- but the MECHANISM moved: it is now
 * `GatewayLlmProvider`'s own call, through `gatewayChat`, failing closed (no
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
const EMBEDDING_MODEL_NAME = { openai: "text-embedding-3-small", google: "gemini-embedding-001" } as const;
vi.mock("@/lib/ai/embeddings", () => ({
  getUserEmbeddings: (...args: unknown[]) => getUserEmbeddingsMock(...args),
  embeddingModelTag: (provider: "openai" | "google") => `${provider}:${EMBEDDING_MODEL_NAME[provider]}`,
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

  it("THROWS when DevShimProvider.fromEnv() returns null AND the GatewayLlmProvider fallback's own gateway call fails -- no marked pass either way", async () => {
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

  it("a deterministic gateway block surfaces as a TYPED blockKind on GatewayCallFailedError (no message matching): no key, per-user monthly cap", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    const { GatewayCallFailedError } = await import("../llm/gateway-provider");
    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "claim", provenance_quote: "quote" }]);
    const run = () =>
      STAGE_HANDLERS.verifying_grounding!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    for (const [result, kind] of [
      [{ ok: false, message: "whatever words", noKey: true }, "no_key"],
      [{ ok: false, message: "whatever words", monthlyCapBlocked: true }, "monthly_cap"],
      [{ ok: false, message: "provider timed out", errorKind: "timeout" }, undefined],
    ] as const) {
      vi.mocked(gatewayChat).mockResolvedValue(result as never);
      const error = await run().catch((e) => e);
      expect(error).toBeInstanceOf(GatewayCallFailedError);
      expect((error as InstanceType<typeof GatewayCallFailedError>).blockKind).toBe(kind);
    }
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
    /** P2-14: the array-response arm of `.range()`, for batch mode. */
    chunks?: { id: string; text: string; page_start: number; page_end: number; section_id?: string | null }[];
    /** P2-14: `books.ingestion_mode` -- defaults to 'standard' so every existing test (which never sets this) keeps exercising the pre-P2-14 code path with zero changes. */
    ingestionMode?: "standard" | "batch";
    /** books.reader_source: absent/null/'pdf' = a PDF with real page numbers; 'epub'/'text' = no real pages. */
    readerSource?: string | null;
    /** book_sections rows (id, title), only ever read for a non-paged book. */
    sections?: { id: string; title: string }[];
    onDelete?: (eqCalls: [string, unknown][]) => void;
    onInsert?: (rows: unknown[]) => void;
  }) {
    return {
      from(table: string) {
        if (table === "books") {
          return {
            select() {
              return {
                eq() {
                  return { single: async () => ({ data: { ingestion_mode: opts.ingestionMode ?? "standard", reader_source: opts.readerSource }, error: null }) };
                },
              };
            },
          };
        }
        if (table === "book_sections") {
          return { select: () => ({ eq: () => ({ then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.sections ?? [], error: null }) }) }) };
        }
        if (table === "source_chunks") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        range() {
                          return {
                            maybeSingle: async () => ({ data: opts.chunk, error: null }),
                            // P2-14 batch mode / PERF-1 concurrency: `await`ed directly
                            // (no `.maybeSingle()`) for an array response. Falls back to
                            // wrapping `opts.chunk` in a one-element array when `chunks`
                            // isn't given, so every pre-PERF-1 test that only ever set
                            // `chunk:` (simulating exactly one row on the far side of a
                            // real `.range()`) keeps working unmodified under the new
                            // unified fetch path -- see extractingLessonsStage's own
                            // `batchSize === 1 && concurrency === 1` branch for why that
                            // path alone still uses `.maybeSingle()` at all.
                            then: (resolve: (v: { data: unknown; error: null }) => void) =>
                              resolve({ data: opts.chunks ?? (opts.chunk ? [opts.chunk] : []), error: null }),
                          };
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

  it("throws when DevShimProvider.fromEnv() returns null AND the GatewayLlmProvider fallback's own gateway call fails -- no HeuristicProvider fallback either way", async () => {
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

  describe("books without real page numbers (EPUB / TXT / Markdown)", () => {
    const candidate = { title: "t", coreClaim: "claim", mechanism: "mech", actionTemplate: "act", evidenceStrength: "author_anecdote" as const, provenanceQuote: "quote", pageRef: 7, sourceChunkId: "c1" };

    async function run(readerSource: string | null | undefined) {
      const { DevShimProvider } = await import("../llm/dev-shim-provider");
      const extractLessons = vi.fn().mockResolvedValue([candidate]);
      vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ extractLessons, lastUsage: { promptTokens: 1, completionTokens: 1 } } as never);
      const { STAGE_HANDLERS } = await import("../worker-stages");
      let insertedRows: Record<string, unknown>[] = [];
      const supabase = makeSupabase({
        chunk: { id: "c1", text: "passage text", page_start: 7, page_end: 7, section_id: "s1" },
        readerSource,
        sections: [{ id: "s1", title: "Chapter 3: Habits" }],
        onInsert: (rows) => (insertedRows = rows as Record<string, unknown>[]),
      });
      await STAGE_HANDLERS.extracting_lessons!({ job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });
      return { insertedRows, input: extractLessons.mock.calls[0]![0] as { pageStart: number; locationLabel?: string } };
    }

    it.each(["epub", "text"])("%s: lessons store page_ref NULL and the prompt cites the section, not a page", async (source) => {
      const { insertedRows, input } = await run(source);
      expect(insertedRows[0]!["page_ref"]).toBeNull();
      expect(input.locationLabel).toBe('section "Chapter 3: Habits"');
    });

    it.each([["pdf"], [null], [undefined]])("a PDF (reader_source %s) keeps its real page numbers and the page-based prompt", async (source) => {
      const { insertedRows, input } = await run(source);
      expect(insertedRows[0]!["page_ref"]).toBe(7);
      expect(input.locationLabel).toBeUndefined();
    });
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

  // P2-14 batch mode -- shares this describe block's own `makeSupabase`,
  // `beforeEach`/`afterEach` above (module-scoped `DevShimProvider`/
  // `gatewayChat` mocks reset the same way every other test here relies on).
  const CHUNK_A = {
    id: "c1",
    text: "The two-minute rule states that when you start a new habit, it should take less than two minutes to do. This works because almost any habit can be scaled down into a two-minute version.",
    page_start: 1,
    page_end: 1,
  };
  const CHUNK_B = {
    id: "c2",
    text: "Deep work is the ability to focus without distraction on a cognitively demanding task. This skill is becoming increasingly rare and increasingly valuable in our economy.",
    page_start: 5,
    page_end: 5,
  };

  function insertTracker() {
    const byChunk: Record<string, unknown[]> = {};
    return {
      byChunk,
      onInsert: (rows: unknown[]) => {
        for (const row of rows as Record<string, unknown>[]) {
          const key = row["source_chunk_id"] as string;
          (byChunk[key] ??= []).push(row);
        }
      },
    };
  }

  it("a book in batch mode with 2 available chunks makes ONE combined gatewayChat call and advances the cursor by 2, not 1", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null); // forces the real GatewayLlmProvider, so `instanceof GatewayLlmProvider` is true and the batch branch actually engages
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        results: [
          {
            lessons: [
              {
                title: "Shrink new habits to two minutes",
                core_claim: "Beginning any new routine works best when kept trivially quick to complete.",
                mechanism: "A tiny starting version removes the friction that normally stops a habit before it forms.",
                action_template: "Define a two-minute version of one habit.",
                provenance_quote:
                  "The two-minute rule states that when you start a new habit, it should take less than two minutes to do.",
              },
            ],
          },
          {
            lessons: [
              {
                title: "Protect blocks of undistracted focus",
                core_claim: "Sustained concentration on hard problems, free of interruption, is a distinct valuable skill.",
                mechanism: "Demanding cognitive work degrades sharply under fragmented attention.",
                action_template: "Schedule a distraction-free block for your hardest task.",
                provenance_quote: "Deep work is the ability to focus without distraction on a cognitively demanding task.",
              },
            ],
          },
        ],
      }),
      usage: { promptTokens: 900, cachedPromptTokens: 0, completionTokens: 300, reasoningTokens: 0 },
      costUsd: 0.001,
      keySource: "server",
      attempts: 1,
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { byChunk, onInsert } = insertTracker();
    const supabase = makeSupabase({ chunk: null, chunks: [CHUNK_A, CHUNK_B], ingestionMode: "batch", onInsert });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(gatewayChat).toHaveBeenCalledTimes(1); // ONE combined call for both chunks -- the entire point of batching
    expect(result.nextStage).toBe("extracting_lessons");
    expect(result.nextChunkIndex).toBe(2); // advanced by the batch count, not +1
    expect(byChunk["c1"]).toHaveLength(1);
    expect(byChunk["c2"]).toHaveLength(1);
  });

  it("THE REGRESSION GUARD: a malformed batch response falls back to per-chunk calls and still writes lessons for EVERY chunk in the batch -- never skips content silently", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    const okSingle = (quote: string) => ({
      ok: true,
      content: JSON.stringify({
        lessons: [
          {
            title: "t",
            core_claim: "A restated claim expressed in entirely different words than the source passage itself.",
            mechanism: "m",
            action_template: "a",
            provenance_quote: quote,
          },
        ],
      }),
      usage: { promptTokens: 400, cachedPromptTokens: 0, completionTokens: 150, reasoningTokens: 0 },
      costUsd: 0.0005,
      keySource: "server",
      attempts: 1,
    });
    vi.mocked(gatewayChat)
      .mockResolvedValueOnce({
        ok: true,
        content: "not json at all",
        usage: { promptTokens: 900, cachedPromptTokens: 0, completionTokens: 10, reasoningTokens: 0 },
        costUsd: 0.001,
        keySource: "server",
        attempts: 1,
      } as never) // the batch call itself -- malformed
      .mockResolvedValueOnce(okSingle(CHUNK_A.text) as never) // fallback for chunk A
      .mockResolvedValueOnce(okSingle(CHUNK_B.text) as never); // fallback for chunk B

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { byChunk, onInsert } = insertTracker();
    const supabase = makeSupabase({ chunk: null, chunks: [CHUNK_A, CHUNK_B], ingestionMode: "batch", onInsert });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(gatewayChat).toHaveBeenCalledTimes(3); // 1 batch attempt + 2 per-chunk fallback calls
    expect(byChunk["c1"]).toHaveLength(1); // neither chunk's content was silently dropped
    expect(byChunk["c2"]).toHaveLength(1);
    expect(result.nextChunkIndex).toBe(2);
  });

  // PERF-1 (2026-09-19, BRIEF-perf-concurrency.md): this used to be an
  // unconditional invariant ("standard mode always processes exactly one").
  // It is now a TUNABLE invariant, true only at concurrency=1, which the
  // brief requires reproduce today's exact sequential behavior -- see the
  // dedicated "PERF-1: bounded concurrency" describe block below for the
  // new concurrency>1 behavior this same scenario is meant to enable.
  it("Condition 1 regression guard: standard mode with multiple chunks available still processes ONE at a time when concurrency=1", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "1");
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      extractLessons: vi.fn().mockResolvedValue([]),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({
      chunk: CHUNK_A,
      chunks: [CHUNK_A, CHUNK_B], // present in the mock, but must be ignored at concurrency=1
      ingestionMode: "standard",
    });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(result.nextChunkIndex).toBe(1); // +1, not +2 -- unaffected by chunks[] being present in the mock
    vi.unstubAllEnvs();
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
    /** P2-14: the array-response arm of `.range()`, for batch mode. */
    lessons?: Record<string, unknown>[];
    /** P2-14: `books.ingestion_mode` -- defaults to 'standard' so every existing test (which never sets this) keeps exercising the pre-P2-14 code path with zero changes. */
    ingestionMode?: "standard" | "batch";
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
        if (table === "books") {
          return {
            select() {
              return {
                eq() {
                  return { single: async () => ({ data: { ingestion_mode: opts.ingestionMode ?? "standard" }, error: null }) };
                },
              };
            },
          };
        }
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
                              return {
                                maybeSingle: async () => ({ data: opts.lesson, error: null }),
                                // P2-14 batch mode / PERF-1 concurrency: `await`ed directly
                                // (no `.maybeSingle()`) for an array response. Falls back to
                                // wrapping `opts.lesson` in a one-element array when `lessons`
                                // isn't given -- same reasoning as the source_chunks mock
                                // above, see that one's own comment.
                                then: (resolve: (v: { data: unknown; error: null }) => void) =>
                                  resolve({ data: opts.lessons ?? (opts.lesson ? [opts.lesson] : []), error: null }),
                              };
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

  it("throws when DevShimProvider.fromEnv() returns null AND the GatewayLlmProvider fallback's own gateway call fails -- no HeuristicProvider fallback either way", async () => {
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

  // P2-14 batch mode -- shares this describe block's own `makeSupabase`,
  // `beforeEach`/`afterEach` above.
  const LESSON_1 = {
    id: "l1",
    title: "Shrink new habits to two minutes",
    core_claim: "Beginning any new routine works best when kept trivially quick to complete.",
    mechanism: "A tiny starting version removes friction that normally stops a habit before it forms.",
    action_template: "Define a two-minute version of one habit.",
    evidence_strength: "author_anecdote",
    provenance_quote: "quote1",
    page_ref: 1,
    source_chunk_id: "c1",
  };
  const LESSON_2 = {
    id: "l2",
    title: "Protect blocks of undistracted focus",
    core_claim: "Sustained concentration on hard problems, free of interruption, is a distinct valuable skill.",
    mechanism: "Demanding cognitive work degrades sharply under fragmented attention.",
    action_template: "Schedule a distraction-free block for your hardest task.",
    evidence_strength: "author_anecdote",
    provenance_quote: "quote2",
    page_ref: 2,
    source_chunk_id: "c2",
  };

  function cardFields(overrides: Partial<Record<string, string>> = {}) {
    return {
      free_recall_prompt: "What does this lesson claim about the ideal length of a new habit's first version?",
      application_prompt: "You want to start flossing every night but keep skipping it -- what's the two-minute version?",
      application_answer: "Floss just one tooth for the first week, so the habit takes under two minutes to complete.",
      why_prompt: "In your own words, why does a tiny starting version make a new habit more likely to stick?",
      ...overrides,
    };
  }

  function cardsInsertTracker() {
    const byLesson: Record<string, unknown[]> = {};
    return {
      byLesson,
      onCardsInsert: (rows: unknown[]) => {
        for (const row of rows as Record<string, unknown>[]) {
          const key = row["lesson_id"] as string;
          (byLesson[key] ??= []).push(row);
        }
      },
    };
  }

  it("a book in batch mode with 2 available lessons makes ONE combined gatewayChat call and advances the cursor by 2, not 1", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null); // forces the real GatewayLlmProvider so `instanceof GatewayLlmProvider` is true
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        results: [cardFields(), cardFields({ free_recall_prompt: "What skill does this lesson say is worth protecting?" })],
      }),
      usage: { promptTokens: 900, cachedPromptTokens: 0, completionTokens: 300, reasoningTokens: 0 },
      costUsd: 0.001,
      keySource: "server",
      attempts: 1,
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { byLesson, onCardsInsert } = cardsInsertTracker();
    const supabase = makeSupabase({ lesson: null, lessons: [LESSON_1, LESSON_2], ingestionMode: "batch", onCardsInsert });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(gatewayChat).toHaveBeenCalledTimes(1); // ONE combined call for both lessons
    expect(result.nextStage).toBe("generating_cards");
    expect(result.nextChunkIndex).toBe(2); // advanced by the batch count, not +1
    expect(byLesson["l1"]!.length).toBeGreaterThan(0);
    expect(byLesson["l2"]!.length).toBeGreaterThan(0);
  });

  it("THE REGRESSION GUARD: a malformed batch response falls back to per-lesson calls and still creates cards for EVERY lesson in the batch -- never skips content silently", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);
    const { gatewayChat } = await import("@/lib/ai/gateway");
    const okSingle = (overrides: Partial<Record<string, string>> = {}) => ({
      ok: true,
      content: JSON.stringify(cardFields(overrides)),
      usage: { promptTokens: 400, cachedPromptTokens: 0, completionTokens: 150, reasoningTokens: 0 },
      costUsd: 0.0005,
      keySource: "server",
      attempts: 1,
    });
    vi.mocked(gatewayChat)
      .mockResolvedValueOnce({
        ok: true,
        content: "not json at all",
        usage: { promptTokens: 900, cachedPromptTokens: 0, completionTokens: 10, reasoningTokens: 0 },
        costUsd: 0.001,
        keySource: "server",
        attempts: 1,
      } as never) // the batch call itself -- malformed
      .mockResolvedValueOnce(okSingle() as never) // fallback for lesson 1
      .mockResolvedValueOnce(okSingle() as never); // fallback for lesson 2

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const { byLesson, onCardsInsert } = cardsInsertTracker();
    const supabase = makeSupabase({ lesson: null, lessons: [LESSON_1, LESSON_2], ingestionMode: "batch", onCardsInsert });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(gatewayChat).toHaveBeenCalledTimes(3); // 1 batch attempt + 2 per-lesson fallback calls
    expect(byLesson["l1"]!.length).toBeGreaterThan(0); // neither lesson's cards were silently dropped
    expect(byLesson["l2"]!.length).toBeGreaterThan(0);
    expect(result.nextChunkIndex).toBe(2);
  });

  // PERF-1 (2026-09-19, BRIEF-perf-concurrency.md): this used to be an
  // unconditional invariant ("standard mode always processes exactly one").
  // It is now a TUNABLE invariant, true only at concurrency=1 -- see the
  // dedicated "PERF-1: bounded concurrency" describe block below for the
  // new concurrency>1 behavior this same scenario is meant to enable.
  it("Condition 1 regression guard: standard mode with multiple lessons available still processes ONE at a time when concurrency=1", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "1");
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({
      generateCards: vi.fn().mockResolvedValue([{ promptType: "free_recall", prompt: "p", answer: "a" }]),
      lastUsage: { promptTokens: 1, completionTokens: 1 },
    } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({
      lesson: LESSON_1,
      lessons: [LESSON_1, LESSON_2], // present in the mock, but must be ignored at concurrency=1
      ingestionMode: "standard",
    });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(result.nextChunkIndex).toBe(1); // +1, not +2 -- unaffected by lessons[] being present in the mock
    vi.unstubAllEnvs();
  });
});

/**
 * PERF-1 (2026-09-19, BRIEF-perf-concurrency.md): bounded concurrency for
 * extractingLessonsStage/generatingCardsStage's LLM calls. These tests
 * exist because a test where everything resolves instantly proves nothing
 * about ordering (the brief's own warning) -- every ordering test below
 * deliberately makes the LAST-fetched item resolve FIRST, so a push-based
 * (rather than index-based) result array would silently misattribute
 * content between chunks/lessons. Confirmed these have teeth: temporarily
 * changed the group loop in worker-stages.ts back to `Promise.all(...).then(rs
 * => rs.forEach(r => arr.push(r)))` (the naive concurrent rewrite the brief
 * warns about) and watched the two ordering tests below fail with swapped
 * titles, before restoring the real (index-assigning) implementation and
 * re-confirming green.
 */
describe("PERF-1: bounded concurrency (extracting_lessons, generating_cards)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // section_id defaults to `sec-<id>` (distinct per chunk), deliberately --
  // it's the ordering-bug detector for extraction: `section_id` is attached
  // to a written row from `chunkRows[i]` (fetch-order-indexed) while the
  // row's OTHER content comes from `perChunkCandidates[i]` (concurrency-
  // sourced) -- see the ordering test's own comment for why a candidate's
  // OWN `sourceChunkId` field can't be used to detect this class of bug on
  // its own (it travels WITH the candidate, so it's self-consistent even
  // when misaligned to the wrong chunkRow).
  function chunkFixture(id: string, text: string, pageStart = 1) {
    return { id, text, page_start: pageStart, page_end: pageStart, section_id: `sec-${id}` };
  }

  function candidateFor(sourceChunkId: string, quote: string) {
    return {
      title: `from-${sourceChunkId}`,
      coreClaim: "claim",
      mechanism: "mech",
      actionTemplate: "act",
      evidenceStrength: "author_anecdote" as const,
      provenanceQuote: quote,
      pageRef: 1,
      sourceChunkId,
    };
  }

  function makeExtractionSupabase(opts: {
    chunks: ReturnType<typeof chunkFixture>[];
    ingestionMode?: "standard" | "batch";
    onDelete?: (chunkId: string) => void;
    onInsert?: (rows: Record<string, unknown>[]) => void;
  }) {
    return {
      from(table: string) {
        if (table === "books") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { ingestion_mode: opts.ingestionMode ?? "standard" }, error: null }) }) }) };
        }
        if (table === "source_chunks") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  range: () => ({
                    maybeSingle: async () => ({ data: opts.chunks[0] ?? null, error: null }),
                    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.chunks, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "lessons") {
          return {
            delete: () => ({
              eq: (col: string, val: string) => ({
                eq: () => ({
                  then: (resolve: (v: { error: null }) => void) => {
                    if (col === "source_chunk_id") opts.onDelete?.(val);
                    resolve({ error: null });
                  },
                }),
              }),
            }),
            insert: async (rows: Record<string, unknown>[]) => {
              opts.onInsert?.(rows);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  it("extracting_lessons: preserves input order under concurrency even when the LAST-fetched chunk resolves FIRST (standard mode)", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "3");
    const chunks = [chunkFixture("c1", "passage one text"), chunkFixture("c2", "passage two text"), chunkFixture("c3", "passage three text")];
    // Deliberately scrambled: c3 (fetched LAST) resolves FIRST, c1 (fetched
    // FIRST) resolves LAST -- the opposite of fetch order.
    const delayMsById: Record<string, number> = { c1: 30, c2: 20, c3: 5 };
    const extractLessons = vi.fn(async (input: { sourceChunkId: string; chunkText: string }) => {
      await delay(delayMsById[input.sourceChunkId]!);
      return [candidateFor(input.sourceChunkId, input.chunkText)];
    });
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ extractLessons, lastUsage: { promptTokens: 1, completionTokens: 1 } } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const byChunk: Record<string, Record<string, unknown>[]> = {};
    const supabase = makeExtractionSupabase({
      chunks,
      onInsert: (rows) => {
        for (const row of rows) (byChunk[row["source_chunk_id"] as string] ??= []).push(row);
      },
    });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(result.nextChunkIndex).toBe(3);
    // The candidate's OWN `sourceChunkId` field travels WITH it regardless
    // of array position, so a row keyed by `source_chunk_id` would look
    // self-consistent even under an index-misalignment bug -- `section_id`
    // is the real detector here, because worker-stages.ts attaches it from
    // `chunkRows[i]` (fetch-order-indexed) onto whatever candidate content
    // ends up at `perChunkCandidates[i]` (concurrency-sourced). A bug that
    // mismatches those two arrays would show up as chunk c1's row carrying
    // a DIFFERENT chunk's section_id, even though source_chunk_id itself
    // still reads correctly.
    expect(byChunk["c1"]?.[0]).toMatchObject({ title: "from-c1", provenance_quote: "passage one text", section_id: "sec-c1" });
    expect(byChunk["c2"]?.[0]).toMatchObject({ title: "from-c2", provenance_quote: "passage two text", section_id: "sec-c2" });
    expect(byChunk["c3"]?.[0]).toMatchObject({ title: "from-c3", provenance_quote: "passage three text", section_id: "sec-c3" });
  });

  it("extracting_lessons: a single mid-flight provider failure fails the whole stage closed, with NO lessons write for any chunk", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "3");
    const chunks = [chunkFixture("c1", "passage one"), chunkFixture("c2", "passage two"), chunkFixture("c3", "passage three")];
    const extractLessons = vi.fn(async (input: { sourceChunkId: string; chunkText: string }) => {
      if (input.sourceChunkId === "c2") {
        await delay(5);
        throw new Error("gateway boom for c2");
      }
      await delay(20); // c1/c3 are slower -- still in flight when c2 rejects
      return [candidateFor(input.sourceChunkId, input.chunkText)];
    });
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ extractLessons, lastUsage: null } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let deleteCalled = false;
    let insertCalled = false;
    const supabase = makeExtractionSupabase({
      chunks,
      onDelete: () => (deleteCalled = true),
      onInsert: () => (insertCalled = true),
    });

    await expect(
      STAGE_HANDLERS.extracting_lessons!({
        job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow("gateway boom for c2");

    // No partial write: c1 and c3's own calls succeed (and are computed),
    // but because c2 failed, this invocation must not have written lessons
    // for ANY chunk -- not even the ones whose own extraction genuinely
    // succeeded.
    expect(deleteCalled).toBe(false);
    expect(insertCalled).toBe(false);
  });

  it("extracting_lessons: concurrency=1 processes chunks one at a time even when several are available (today's exact behavior)", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "1");
    const chunks = [chunkFixture("c1", "passage one"), chunkFixture("c2", "passage two")];
    let inFlight = 0;
    let maxInFlight = 0;
    const extractLessons = vi.fn(async (input: { sourceChunkId: string; chunkText: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return [candidateFor(input.sourceChunkId, input.chunkText)];
    });
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ extractLessons, lastUsage: { promptTokens: 1, completionTokens: 1 } } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeExtractionSupabase({ chunks });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    // Only ONE row is ever fetched at concurrency=1 (the `.maybeSingle()`
    // fast path), even though `chunks` has two available -- same invariant
    // the "Condition 1" test above proves for the mock-fixture shape; this
    // one additionally proves no more than one call is ever in flight.
    expect(result.nextChunkIndex).toBe(1);
    expect(maxInFlight).toBe(1);
  });

  it("extracting_lessons (batch mode): two BATCH_SIZE_EXTRACT-sized groups run concurrently and reassemble in fetch order, even though the SECOND group's combined call resolves FIRST", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "2");
    const group1 = [
      chunkFixture("g1-1", "Group one alpha. UNIQUE-MARKER-ONE."),
      chunkFixture("g1-2", "Group one beta. UNIQUE-MARKER-ONE."),
      chunkFixture("g1-3", "Group one gamma. UNIQUE-MARKER-ONE."),
      chunkFixture("g1-4", "Group one delta. UNIQUE-MARKER-ONE."),
    ];
    const group2 = [
      chunkFixture("g2-1", "Group two alpha. UNIQUE-MARKER-TWO."),
      chunkFixture("g2-2", "Group two beta. UNIQUE-MARKER-TWO."),
      chunkFixture("g2-3", "Group two gamma. UNIQUE-MARKER-TWO."),
      chunkFixture("g2-4", "Group two delta. UNIQUE-MARKER-TWO."),
    ];

    function batchResponse(group: ReturnType<typeof chunkFixture>[]) {
      return {
        ok: true,
        content: JSON.stringify({
          results: group.map((c) => ({
            lessons: [{ title: `from-${c.id}`, core_claim: "a restated claim in different words", mechanism: "m", action_template: "a", provenance_quote: c.text }],
          })),
        }),
        usage: { promptTokens: 100, cachedPromptTokens: 0, completionTokens: 50, reasoningTokens: 0 },
        costUsd: 0.0002,
        keySource: "server",
        attempts: 1,
      };
    }

    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null); // force the real GatewayLlmProvider so batching engages
    const { gatewayChat } = await import("@/lib/ai/gateway");
    vi.mocked(gatewayChat).mockImplementation(async (..._args: unknown[]) => {
      const messages = _args[3] as { role: string; content: string }[];
      const userPrompt = messages[1]!.content;
      if (userPrompt.includes("UNIQUE-MARKER-ONE")) {
        await delay(30); // group 1, fetched FIRST, resolves LAST
        return batchResponse(group1) as never;
      }
      if (userPrompt.includes("UNIQUE-MARKER-TWO")) {
        await delay(5); // group 2, fetched SECOND, resolves FIRST
        return batchResponse(group2) as never;
      }
      throw new Error("test bug: unrecognized prompt");
    });

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const byChunk: Record<string, Record<string, unknown>[]> = {};
    const supabase = makeExtractionSupabase({
      chunks: [...group1, ...group2],
      ingestionMode: "batch",
      onInsert: (rows) => {
        for (const row of rows) (byChunk[row["source_chunk_id"] as string] ??= []).push(row);
      },
    });

    const result = await STAGE_HANDLERS.extracting_lessons!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(gatewayChat).toHaveBeenCalledTimes(2); // one combined call per group, never per chunk
    expect(result.nextChunkIndex).toBe(8);
    // section_id is the real cross-GROUP misalignment detector -- same
    // reasoning as the standard-mode test above, one level up: a bug that
    // reordered `groupResults` (group2's flattened candidates landing where
    // group1's belong) would show up as group1's own chunkRows carrying
    // group2's candidate content, with group1's OWN section_ids attached to
    // the wrong content.
    for (const c of [...group1, ...group2]) {
      expect(byChunk[c.id]?.[0]).toMatchObject({ title: `from-${c.id}`, provenance_quote: c.text, section_id: c.section_id });
    }
  });

  function makeCardsSupabase(opts: {
    lessons: { id: string; title: string; core_claim: string; provenance_quote: string; source_chunk_id: string }[];
    onDelete?: (lessonId: string) => void;
    onCardsInsert?: (rows: Record<string, unknown>[]) => void;
  }) {
    let nextCardId = 0;
    return {
      from(table: string) {
        if (table === "books") {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { ingestion_mode: "standard" }, error: null }) }) }) };
        }
        if (table === "lessons") {
          return {
            select: () => ({
              eq: () => ({
                not: () => ({
                  order: () => ({
                    range: () => ({ then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.lessons, error: null }) }),
                  }),
                }),
              }),
            }),
            update: () => ({ eq: () => ({ eq: () => ({ then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) }) }) }),
          };
        }
        if (table === "cards") {
          return {
            delete: () => ({
              eq: (_col: string, val: string) => ({
                then: (resolve: (v: { error: null }) => void) => {
                  opts.onDelete?.(val);
                  resolve({ error: null });
                },
              }),
            }),
            insert: (rows: Record<string, unknown>[]) => {
              opts.onCardsInsert?.(rows);
              const inserted = rows.map(() => ({ id: `card-${nextCardId++}` }));
              return { select: async () => ({ data: inserted, error: null }) };
            },
          };
        }
        if (table === "card_states") {
          return { insert: async () => ({ error: null }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  it("generating_cards: preserves input order under concurrency even when the LAST-fetched lesson resolves FIRST", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "3");
    const lessons = [
      { id: "l1", title: "t1", core_claim: "c1", provenance_quote: "q1", source_chunk_id: "c1" },
      { id: "l2", title: "t2", core_claim: "c2", provenance_quote: "q2", source_chunk_id: "c2" },
      { id: "l3", title: "t3", core_claim: "c3", provenance_quote: "q3", source_chunk_id: "c3" },
    ];
    const delayMsById: Record<string, number> = { l1: 30, l2: 20, l3: 5 };
    const generateCards = vi.fn(async ({ lesson }: { lesson: { title: string } }) => {
      const lessonId = lessons.find((l) => l.title === lesson.title)!.id;
      await delay(delayMsById[lessonId]!);
      return [{ promptType: "free_recall" as const, prompt: `prompt-for-${lessonId}`, answer: "a" }];
    });
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ generateCards, lastUsage: { promptTokens: 1, completionTokens: 1 } } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const byLesson: Record<string, Record<string, unknown>[]> = {};
    const supabase = makeCardsSupabase({
      lessons,
      onCardsInsert: (rows) => {
        for (const row of rows) (byLesson[row["lesson_id"] as string] ??= []).push(row);
      },
    });

    const result = await STAGE_HANDLERS.generating_cards!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(result.nextChunkIndex).toBe(3);
    expect(byLesson["l1"]?.[0]).toMatchObject({ prompt: "prompt-for-l1" });
    expect(byLesson["l2"]?.[0]).toMatchObject({ prompt: "prompt-for-l2" });
    expect(byLesson["l3"]?.[0]).toMatchObject({ prompt: "prompt-for-l3" });
  });

  it("generating_cards: a single mid-flight provider failure fails the whole stage closed, with NO cards write for any lesson", async () => {
    vi.stubEnv("SELF_MASTERY_INGESTION_CONCURRENCY", "3");
    const lessons = [
      { id: "l1", title: "t1", core_claim: "c1", provenance_quote: "q1", source_chunk_id: "c1" },
      { id: "l2", title: "t2", core_claim: "c2", provenance_quote: "q2", source_chunk_id: "c2" },
      { id: "l3", title: "t3", core_claim: "c3", provenance_quote: "q3", source_chunk_id: "c3" },
    ];
    const generateCards = vi.fn(async ({ lesson }: { lesson: { title: string } }) => {
      if (lesson.title === "t2") {
        await delay(5);
        throw new Error("gateway boom for l2");
      }
      await delay(20);
      return [{ promptType: "free_recall" as const, prompt: "p", answer: "a" }];
    });
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue({ generateCards, lastUsage: null } as never);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    let deleteCalled = false;
    let insertCalled = false;
    const supabase = makeCardsSupabase({
      lessons,
      onDelete: () => (deleteCalled = true),
      onCardsInsert: () => (insertCalled = true),
    });

    await expect(
      STAGE_HANDLERS.generating_cards!({
        job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow("gateway boom for l2");

    expect(deleteCalled).toBe(false);
    expect(insertCalled).toBe(false);
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

/**
 * P2-13 Slice C: `embeddingStage` (CHUNK-scoped, `chunking` -> `embedding`
 * -> `extracting_lessons`). `getUserEmbeddings` is mocked (same shared mock
 * Slice B's tests above use, own full suite in
 * lib/ai/__tests__/embeddings.test.ts) -- these tests only prove the
 * WIRING: a bounded batch is fetched and offered to it, a real result
 * writes embedding+embedding_model per row, any failure degrades to
 * writing nothing rather than throwing, and the cursor/stage transitions
 * match the same MAP shape extractingLessonsStage/generatingCardsStage use.
 */
describe("embedding stage — P2-13 Slice C", () => {
  function makeEmbeddingSupabase(chunks: { id: string; text: string }[]) {
    const updates: { id: string; embedding: unknown; embedding_model: unknown }[] = [];
    const supabase = {
      from(table: string) {
        if (table === "source_chunks") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        range(from: number, to: number) {
                          return { then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: chunks.slice(from, to + 1), error: null }) };
                        },
                      };
                    },
                  };
                },
              };
            },
            update(vals: Record<string, unknown>) {
              const builder = {
                eq(col: string, val: unknown) {
                  if (col === "id") updates.push({ id: val as string, embedding: vals.embedding, embedding_model: vals.embedding_model });
                  return builder;
                },
                then(resolve: (v: { error: null }) => void) {
                  resolve({ error: null });
                },
              };
              return builder;
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { supabase, updates };
  }

  beforeEach(() => {
    getUserEmbeddingsMock.mockReset();
  });

  it("calls getUserEmbeddings with this job's own user id and every fetched chunk's text", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "no_key" });
    const { supabase } = makeEmbeddingSupabase([{ id: "c1", text: "passage one" }, { id: "c2", text: "passage two" }]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    await STAGE_HANDLERS.embedding!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-77", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(getUserEmbeddingsMock).toHaveBeenCalled();
    const call = getUserEmbeddingsMock.mock.calls[0]!;
    expect(call[1]).toBe("owner-77");
    expect(call[2]).toEqual(["passage one", "passage two"]);
  });

  it("a successful result writes embedding (as a pgvector literal) + embedding_model per chunk, and advances the cursor by the batch size", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "ok", provider: "openai", embeddings: [[0.1, 0.2], [0.3, 0.4]] });
    const { supabase, updates } = makeEmbeddingSupabase([{ id: "c1", text: "passage one" }, { id: "c2", text: "passage two" }]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.embedding!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(updates).toEqual([
      { id: "c1", embedding: "[0.1,0.2]", embedding_model: "openai:text-embedding-3-small" },
      { id: "c2", embedding: "[0.3,0.4]", embedding_model: "openai:text-embedding-3-small" },
    ]);
    expect(result).toEqual({ nextStage: "embedding", nextChunkIndex: 2 });
  });

  it("tags a Google result with the gemini model name", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "ok", provider: "google", embeddings: [[0.5, 0.6]] });
    const { supabase, updates } = makeEmbeddingSupabase([{ id: "c1", text: "passage one" }]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    await STAGE_HANDLERS.embedding!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never, supabase: supabase as never });

    expect(updates).toEqual([{ id: "c1", embedding: "[0.5,0.6]", embedding_model: "google:gemini-embedding-001" }]);
  });

  it("status: no_key writes NOTHING for this batch, and the stage still advances -- embeddings are an enhancement, never a pipeline gate", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "no_key" });
    const { supabase, updates } = makeEmbeddingSupabase([{ id: "c1", text: "passage one" }]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.embedding!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });

    expect(updates).toHaveLength(0);
    expect(result).toEqual({ nextStage: "embedding", nextChunkIndex: 1 });
  });

  it("status: unavailable (provider error/spend cap) ALSO degrades gracefully rather than failing the stage", async () => {
    getUserEmbeddingsMock.mockResolvedValue({ status: "unavailable", message: "OpenAI rejected that key." });
    const { supabase, updates } = makeEmbeddingSupabase([{ id: "c1", text: "passage one" }]);
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.embedding!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 0 } as never,
      supabase: supabase as never,
    });
    expect(result).toEqual({ nextStage: "embedding", nextChunkIndex: 1 });
    expect(updates).toHaveLength(0);
  });

  it("advances to extracting_lessons (cursor reset to 0) once every chunk has been offered", async () => {
    const { supabase } = makeEmbeddingSupabase([]); // range() past the last chunk
    const { STAGE_HANDLERS } = await import("../worker-stages");

    const result = await STAGE_HANDLERS.embedding!({
      job: { id: "job-1", book_id: "book-1", user_id: "owner-1", cursor_chunk_index: 40 } as never,
      supabase: supabase as never,
    });

    expect(result).toEqual({ nextStage: "extracting_lessons", nextChunkIndex: 0 });
    expect(getUserEmbeddingsMock).not.toHaveBeenCalled();
  });
});

describe("merging stage: lessons without a page_ref (EPUB / TXT / Markdown) are still spread across the book", () => {
  beforeEach(() => {
    vi.resetModules();
    getUserEmbeddingsMock.mockResolvedValue({ status: "no_key" });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the source chunk's own position for the page spread, so the top picks are not all from the first chapters", async () => {
    const lessons = Array.from({ length: 30 }, (_, i) => ({
      id: `l${i + 1}`,
      title: `Lesson number ${i + 1} about habits`,
      core_claim: `claim ${i + 1}`,
      mechanism: "because of the mechanism ".repeat(4),
      action_template: "Do one small thing",
      evidence_strength: "author_anecdote",
      provenance_quote: `quote ${i + 1}`,
      page_ref: null, // what an EPUB/TXT/MD book stores
      source_chunk_id: `c${i + 1}`,
    }));
    const chunkPage = new Map(lessons.map((l, i) => [l.source_chunk_id, (i + 1) * 2]));
    const ranked: { id: string; rank: number }[] = [];
    const supabase = {
      from(table: string) {
        if (table === "lessons") {
          return {
            update(vals: Record<string, unknown>) {
              let id: string | null = null;
              const b = {
                eq(col: string, v: unknown) {
                  if (col === "id") id = v as string;
                  return b;
                },
                then(resolve: (v: { error: null }) => void) {
                  if (typeof vals["rank"] === "number" && id) ranked.push({ id, rank: vals["rank"] as number });
                  resolve({ error: null });
                },
              };
              return b;
            },
            select: () => ({ eq: () => ({ eq: () => ({ then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: lessons, error: null }) }) }) }),
          };
        }
        if (table === "books") return { select: () => ({ eq: () => ({ single: async () => ({ data: { page_count: 48 }, error: null }) }) }) };
        if (table === "source_chunks") {
          return { select: () => ({ in: (_c: string, ids: string[]) => ({ then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: ids.map((id) => ({ id, page_start: chunkPage.get(id) })), error: null }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const { STAGE_HANDLERS } = await import("../worker-stages");

    await STAGE_HANDLERS.merging!({ job: { id: "job-1", book_id: "book-1", user_id: "owner-1" } as never, supabase: supabase as never });

    expect(ranked).toHaveLength(6); // target = max(6, round(48 pages / 8))
    const pages = ranked.map((r) => chunkPage.get(`c${r.id.slice(1)}`)!).sort((a, b) => a - b);
    expect(pages[pages.length - 1]! - pages[0]!).toBeGreaterThanOrEqual(30); // spread over the book (chunk pages 2..60), not the first six (span 10)
  });
});
