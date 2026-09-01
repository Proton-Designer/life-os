import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null; count?: number } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "lte", "order", "limit", "in"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async (): Promise<{ data: { claims: { sub: string } } | null; error: null }> => ({
  data: { claims: { sub: "user-1" } },
  error: null,
}));
const rpcMock = vi.fn(
  async (_fn: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: null }> => ({
    data: null,
    error: null,
  })
);
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock, rpc: rpcMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Self-Mastery session actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockClear();
  });

  describe("getDueSummary", () => {
    it("returns null for an unauthenticated caller, never throws", async () => {
      getClaimsMock.mockResolvedValueOnce({ data: null, error: null });
      const { getDueSummary } = await import("../self-mastery-session-actions");

      await expect(getDueSummary()).resolves.toBeNull();
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("returns zero without querying user_settings when nothing is due", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        card_states: makeChain({ data: null, error: null, count: 0 }),
      };
      fromImpl = (table) => tables[table];
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 0, estimatedMinutes: 0 });
      expect(fromMock).not.toHaveBeenCalledWith("user_settings");
    });

    it("reads session_target_minutes from user_settings when cards are due", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        card_states: makeChain({ data: null, error: null, count: 12 }),
        user_settings: makeChain({ data: { session_target_minutes: 15 }, error: null }),
      };
      fromImpl = (table) => tables[table];
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 12, estimatedMinutes: 15 });
    });

    it("falls back to the column default (8) when no user_settings row exists yet", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        card_states: makeChain({ data: null, error: null, count: 3 }),
        user_settings: makeChain({ data: null, error: null }),
      };
      fromImpl = (table) => tables[table];
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 3, estimatedMinutes: 8 });
    });
  });

  describe("gradeCard", () => {
    it("fetches current card_states first, then submits the review with confidence passed through", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        card_states: makeChain({ data: null, error: null }), // no prior state -> new card
      };
      fromImpl = (table) => tables[table];
      rpcMock.mockImplementationOnce(async () => ({ data: { id: "review-1" }, error: null }));
      const { gradeCard } = await import("../self-mastery-session-actions");

      await gradeCard({
        cardId: "c1",
        sessionId: "sess-1",
        rating: 3,
        elapsedMs: 4000,
        answeredText: "my answer",
        confidence: "think_so",
      });

      expect(rpcMock).toHaveBeenCalledWith(
        "submit_review",
        expect.objectContaining({ p_card_id: "c1", p_confidence: "think_so", p_answered_text: "my answer" })
      );
    });
  });

  describe("finishSession", () => {
    it("computes dueTomorrow alongside complete_session's own result", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        profiles: makeChain({ data: { timezone: "America/Chicago" }, error: null }),
        card_states: makeChain({ data: null, error: null, count: 5 }),
      };
      fromImpl = (table) => tables[table];
      rpcMock.mockImplementationOnce(async () => ({
        data: { current_streak: 2, longest_streak: 5, freezes_available: 1, total_reviews: 40, total_sessions: 10 },
        error: null,
      }));
      const { finishSession } = await import("../self-mastery-session-actions");

      const result = await finishSession("sess-1");

      expect(rpcMock).toHaveBeenCalledWith("complete_session", { p_session_id: "sess-1" });
      expect(result.dueTomorrow).toBe(5);
      expect(result.currentStreak).toBe(2);
    });
  });
});
