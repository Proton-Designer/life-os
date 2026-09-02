import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * R43: the entailment stage must fail closed, not degrade-and-annotate,
 * when no real provider is available. This is the regression test for
 * that reversal — the FIRST version of worker-stages.ts fell back to
 * HeuristicProvider and recorded a normal success; this suite proves the
 * current version refuses to.
 */

vi.mock("../llm/dev-shim-provider", () => ({
  DevShimProvider: { fromEnv: vi.fn() },
}));

function makeSupabaseWithLessons(
  lessons: { id: string; core_claim: string | null; provenance_quote: string }[],
  notSpy?: (column: string, operator: string, value: unknown) => void,
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

  it("THROWS when DevShimProvider.fromEnv() returns null -- no fallback, no marked pass", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabaseWithLessons([{ id: "l1", core_claim: "claim", provenance_quote: "quote" }]);

    await expect(
      STAGE_HANDLERS.verifying_grounding!({
        job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never,
        supabase: supabase as never,
      }),
    ).rejects.toThrow(/no real entailment provider available/);
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
});

describe("extracting_lessons stage — fail-closed on no real provider, idempotent per-chunk writes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeSupabase(opts: {
    chunk: { id: string; text: string; page_start: number; page_end: number } | null;
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

  it("throws when DevShimProvider.fromEnv() returns null -- no HeuristicProvider fallback", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ chunk: { id: "c1", text: "some passage", page_start: 1, page_end: 1 } });

    await expect(
      STAGE_HANDLERS.extracting_lessons!({ job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never, supabase: supabase as never }),
    ).rejects.toThrow(/no real extraction provider available/);
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
  }) {
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
            insert: async (rows: unknown[]) => {
              opts.onCardsInsert?.(rows);
              return { error: null };
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

  it("throws when DevShimProvider.fromEnv() returns null -- no HeuristicProvider fallback", async () => {
    const { DevShimProvider } = await import("../llm/dev-shim-provider");
    vi.mocked(DevShimProvider.fromEnv).mockReturnValue(null);

    const { STAGE_HANDLERS } = await import("../worker-stages");
    const supabase = makeSupabase({ lesson: LESSON });

    await expect(
      STAGE_HANDLERS.generating_cards!({ job: { id: "job-1", book_id: "book-1", cursor_chunk_index: 0 } as never, supabase: supabase as never }),
    ).rejects.toThrow(/no real card-generation provider available/);
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
});
