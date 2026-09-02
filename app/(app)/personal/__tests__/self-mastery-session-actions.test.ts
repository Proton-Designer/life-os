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

    it("returns zero without querying user_settings when nothing is due and nothing is new, and flags starterDeckMissing when the user has zero books at all", async () => {
      const dueChain = makeChain({ data: null, error: null, count: 0 });
      const newChain = makeChain({ data: null, error: null, count: 0 });
      const booksChain = makeChain({ data: null, error: null, count: 0 });
      let cardStatesCall = 0;
      fromImpl = (table) => {
        if (table === "card_states") {
          cardStatesCall += 1;
          return cardStatesCall === 1 ? dueChain : newChain;
        }
        if (table === "books") return booksChain;
        throw new Error(`unexpected table: ${table}`);
      };
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      // Boss ruling, R7: the onboarding seed step's own failure is
      // deliberately swallowed (completeOnboarding never blocks reaching
      // the app), so by the time Home ever renders, seeding has already
      // been attempted -- zero due, zero new, AND zero books at all is the
      // reliable, structural signal that it never landed. This must not
      // read identically to "genuinely caught up" (which always has at
      // least one book).
      expect(result).toEqual({ dueCount: 0, newCount: 0, estimatedMinutes: 0, starterDeckMissing: true });
      expect(fromMock).not.toHaveBeenCalledWith("user_settings");
    });

    it("does NOT flag starterDeckMissing when nothing is due/new but the user has at least one book -- a genuinely caught-up deck, not a failed seed", async () => {
      const dueChain = makeChain({ data: null, error: null, count: 0 });
      const newChain = makeChain({ data: null, error: null, count: 0 });
      const booksChain = makeChain({ data: null, error: null, count: 1 });
      let cardStatesCall = 0;
      fromImpl = (table) => {
        if (table === "card_states") {
          cardStatesCall += 1;
          return cardStatesCall === 1 ? dueChain : newChain;
        }
        if (table === "books") return booksChain;
        throw new Error(`unexpected table: ${table}`);
      };
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 0, newCount: 0, estimatedMinutes: 0, starterDeckMissing: false });
    });

    it("reads session_target_minutes from user_settings when cards are due", async () => {
      const dueChain = makeChain({ data: null, error: null, count: 12 });
      const newChain = makeChain({ data: null, error: null, count: 4 });
      let cardStatesCall = 0;
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_settings: makeChain({ data: { session_target_minutes: 15 }, error: null }),
      };
      fromImpl = (table) => {
        if (table === "card_states") {
          cardStatesCall += 1;
          return cardStatesCall === 1 ? dueChain : newChain;
        }
        return tables[table];
      };
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 12, newCount: 4, estimatedMinutes: 15, starterDeckMissing: false });
    });

    it("falls back to the column default (8) when no user_settings row exists yet", async () => {
      const dueChain = makeChain({ data: null, error: null, count: 3 });
      const newChain = makeChain({ data: null, error: null, count: 0 });
      let cardStatesCall = 0;
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_settings: makeChain({ data: null, error: null }),
      };
      fromImpl = (table) => {
        if (table === "card_states") {
          cardStatesCall += 1;
          return cardStatesCall === 1 ? dueChain : newChain;
        }
        return tables[table];
      };
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 3, newCount: 0, estimatedMinutes: 8, starterDeckMissing: false });
    });

    it("shows a fresh deck's never-reviewed cards even when dueCount is 0 -- day one, not caught up", async () => {
      const dueChain = makeChain({ data: null, error: null, count: 0 });
      const newChain = makeChain({ data: null, error: null, count: 12 });
      let cardStatesCall = 0;
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_settings: makeChain({ data: { session_target_minutes: 8 }, error: null }),
      };
      fromImpl = (table) => {
        if (table === "card_states") {
          cardStatesCall += 1;
          return cardStatesCall === 1 ? dueChain : newChain;
        }
        return tables[table];
      };
      const { getDueSummary } = await import("../self-mastery-session-actions");

      const result = await getDueSummary();

      expect(result).toEqual({ dueCount: 0, newCount: 12, estimatedMinutes: 8, starterDeckMissing: false });
    });
  });

  describe("getSelfMasteryCandidateInput (R19: real evidence for the arbiter's Self-Mastery candidate)", () => {
    // Takes an ALREADY-FETCHED DueSummary (page.tsx fetches it once,
    // unconditionally, for SessionEntryCard -- getDueSummary isn't
    // cache()-wrapped, so a second internal call would be a real
    // duplicate round trip, not a free re-read).
    it("hasCandidate: false, everything else null, when the summary is null (unauthenticated) -- and never fetches due-card detail", async () => {
      fromImpl = () => {
        throw new Error("fetchDueCardDetail must not run when there is no candidate");
      };
      const { getSelfMasteryCandidateInput } = await import("../self-mastery-session-actions");

      const result = await getSelfMasteryCandidateInput(null);

      expect(result).toEqual({ hasCandidate: false, dueAt: null, decay: null, cost: null });
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("hasCandidate: false when nothing is due and nothing is new (genuinely caught up, or a starter deck that never seeded) -- and never fetches due-card detail", async () => {
      fromImpl = () => {
        throw new Error("fetchDueCardDetail must not run when there is no candidate");
      };
      const { getSelfMasteryCandidateInput } = await import("../self-mastery-session-actions");

      const result = await getSelfMasteryCandidateInput({ dueCount: 0, newCount: 0, estimatedMinutes: 0, starterDeckMissing: false });

      expect(result).toEqual({ hasCandidate: false, dueAt: null, decay: null, cost: null });
    });

    it("a real candidate carries the earliest due card's dueAt, the lowest retrievability among due cards, and the session's own cost estimate", async () => {
      const dueCardRow = {
        stability: 5,
        difficulty: 5,
        due_at: "2026-09-01T12:00:00Z",
        reps: 4,
        lapses: 0,
        state: "review" as const,
        last_review_at: "2026-08-25T12:00:00Z",
      };
      const detailChain = makeChain({ data: [dueCardRow], error: null });
      fromImpl = (table) => {
        if (table === "card_states") return detailChain;
        throw new Error(`unexpected table: ${table}`);
      };
      const { getSelfMasteryCandidateInput } = await import("../self-mastery-session-actions");

      const result = await getSelfMasteryCandidateInput({ dueCount: 3, newCount: 0, estimatedMinutes: 15, starterDeckMissing: false });

      expect(result.hasCandidate).toBe(true);
      expect(result.dueAt).toEqual(new Date(dueCardRow.due_at));
      expect(result.decay).not.toBeNull();
      expect(result.cost).toBe(15); // the session's own estimatedMinutes, not re-derived
    });

    it("a fresh deck (real NEW cards, nothing due yet) is still a real candidate -- dueAt/decay stay null, cost is still real", async () => {
      const detailChain = makeChain({ data: [], error: null }); // no due cards to describe
      fromImpl = (table) => {
        if (table === "card_states") return detailChain;
        throw new Error(`unexpected table: ${table}`);
      };
      const { getSelfMasteryCandidateInput } = await import("../self-mastery-session-actions");

      const result = await getSelfMasteryCandidateInput({ dueCount: 0, newCount: 12, estimatedMinutes: 8, starterDeckMissing: false });

      expect(result).toEqual({ hasCandidate: true, dueAt: null, decay: null, cost: 8 });
    });
  });

  describe("retryStarterDeckSeed (Boss ruling, R7: a seed failure must be visible and recoverable, never silent)", () => {
    it("calls the same seed RPC seedMeditationsDeckForUser uses, and revalidates Home on success", async () => {
      rpcMock.mockResolvedValueOnce({
        data: { seeded: true, alreadySeeded: false, bookId: "book-1", lessonCount: 12, cardCount: 47 },
        error: null,
      });
      const { revalidatePath } = await import("next/cache");
      const { retryStarterDeckSeed } = await import("../self-mastery-session-actions");

      const result = await retryStarterDeckSeed();

      expect(rpcMock).toHaveBeenCalledWith("seed_meditations_deck", expect.objectContaining({ p_lessons: expect.anything() }));
      expect(result).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith("/");
    });

    it("a repeated RPC failure returns ok:false rather than throwing -- the retry button itself must never crash the page", async () => {
      rpcMock.mockRejectedValueOnce(new Error("still down"));
      const { retryStarterDeckSeed } = await import("../self-mastery-session-actions");

      const result = await retryStarterDeckSeed();

      expect(result).toEqual({ ok: false });
    });
  });

  describe("gradeCard", () => {
    it("fetches current card_states first, then submits the review with confidence passed through", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        card_states: makeChain({ data: null, error: null }), // no prior state -> new card
        // gradeCard now loads the caller's own desired_retention rather than
        // letting the scheduler silently fall back to 0.9.
        user_settings: makeChain({
          data: { session_target_minutes: 10, daily_new_limit: 5, ai_grading_enabled: false, desired_retention: 0.9 },
          error: null,
        }),
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
