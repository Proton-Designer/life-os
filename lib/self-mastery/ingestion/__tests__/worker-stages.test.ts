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

function makeSupabaseWithLessons(lessons: { id: string; core_claim: string | null; provenance_quote: string }[]) {
  return {
    from(table: string) {
      if (table !== "lessons") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                order() {
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
});
