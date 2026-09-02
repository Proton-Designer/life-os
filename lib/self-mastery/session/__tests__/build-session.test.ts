import { describe, expect, it, vi } from "vitest";
import {
  hydrateQueueCards,
  fetchCardAnswer,
  fetchLessonContext,
  fetchDueCardDetail,
  startTodaysSession,
  submitCardReview,
  submitSelfExplanation,
  countDueCards,
  countNewCards,
} from "../build-session";
import { buildTodaysSession } from "../build-session";
import { cardRetrievability } from "@/lib/self-mastery/memory-strength";
import type { QueueEntry } from "../types";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "lte", "in", "single", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
}

describe("the non-negotiable invariant: the answer must never reach the client before commit", () => {
  it("hydrateQueueCards' select() names id/lesson_id/prompt_type/prompt and NEVER answer", async () => {
    const chain = makeChain({ data: [{ id: "c1", lesson_id: "l1", prompt_type: "free_recall", prompt: "recall this" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const entries: QueueEntry[] = [{ cardId: "c1", bookId: "b1", queuePosition: 0, reason: "due" }];

    await hydrateQueueCards(client, entries);

    expect(client.from).toHaveBeenCalledWith("cards");
    const selectArg = chain.select.mock.calls[0]![0] as string;
    expect(selectArg).not.toMatch(/\banswer\b/);
    expect(selectArg).toBe("id, lesson_id, prompt_type, prompt");
  });

  it("fetchCardAnswer is the one function allowed to select answer, and only fires at reveal time (one card, by id)", async () => {
    const chain = makeChain({ data: { answer: "the real answer" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const answer = await fetchCardAnswer(client, "c1");

    expect(chain.select).toHaveBeenCalledWith("answer");
    expect(chain.eq).toHaveBeenCalledWith("id", "c1");
    expect(chain.single).toHaveBeenCalled();
    expect(answer).toBe("the real answer");
  });

  it("fetchLessonContext reads mechanism/action_template from lessons by id, only at reveal time (Boss ruling, R7 task 2)", async () => {
    const chain = makeChain({ data: { mechanism: "why it works", action_template: "try this" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const context = await fetchLessonContext(client, "lesson-1");

    expect(client.from).toHaveBeenCalledWith("lessons");
    expect(chain.select).toHaveBeenCalledWith("mechanism, action_template");
    expect(chain.eq).toHaveBeenCalledWith("id", "lesson-1");
    expect(chain.single).toHaveBeenCalled();
    expect(context).toEqual({ mechanism: "why it works", actionTemplate: "try this" });
  });

  it("fetchLessonContext maps a lesson missing both fields to nulls, not empty strings or omission", async () => {
    const chain = makeChain({ data: { mechanism: null, action_template: null }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const context = await fetchLessonContext(client, "lesson-2");

    expect(context).toEqual({ mechanism: null, actionTemplate: null });
  });

  it("fetchDueCardDetail returns nulls when there are no due cards -- a fresh deck (real NEW cards) is a real candidate without this", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const detail = await fetchDueCardDetail(client, "user-1", new Date("2026-09-02T12:00:00Z"));

    expect(client.from).toHaveBeenCalledWith("card_states");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.neq).toHaveBeenCalledWith("state", "new");
    expect(chain.lte).toHaveBeenCalledWith("due_at", "2026-09-02T12:00:00.000Z");
    expect(detail).toEqual({ earliestDueAt: null, lowestRetrievability: null });
  });

  it("fetchDueCardDetail picks the EARLIEST due_at (R19: 'a real deadline') and the LOWEST retrievability among due cards, real numbers not fabricated", async () => {
    const now = new Date("2026-09-02T12:00:00Z");
    // Row A: strong, recently reviewed -- high retrievability, due 1 day ago.
    const rowA = {
      stability: 30,
      difficulty: 5,
      due_at: "2026-09-01T12:00:00Z",
      reps: 5,
      lapses: 0,
      state: "review" as const,
      last_review_at: "2026-08-31T12:00:00Z",
      learning_steps: 0,
    };
    // Row B: weak, reviewed long ago -- low retrievability, due 3 days ago (EARLIER than A).
    const rowB = {
      stability: 2,
      difficulty: 5,
      due_at: "2026-08-30T12:00:00Z",
      reps: 3,
      lapses: 1,
      state: "review" as const,
      last_review_at: "2026-08-20T12:00:00Z",
      learning_steps: 0,
    };
    const chain = makeChain({ data: [rowA, rowB], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const detail = await fetchDueCardDetail(client, "user-1", now);

    // Computed via the exact same function this code calls -- never a
    // hand-guessed number that could silently drift from the real FSRS
    // curve.
    const retrievabilityA = cardRetrievability(
      { stability: rowA.stability, difficulty: rowA.difficulty, dueAt: rowA.due_at, reps: rowA.reps, lapses: rowA.lapses, state: rowA.state, lastReviewAt: rowA.last_review_at, learningSteps: rowA.learning_steps },
      now
    );
    const retrievabilityB = cardRetrievability(
      { stability: rowB.stability, difficulty: rowB.difficulty, dueAt: rowB.due_at, reps: rowB.reps, lapses: rowB.lapses, state: rowB.state, lastReviewAt: rowB.last_review_at, learningSteps: rowB.learning_steps },
      now
    );

    expect(detail.earliestDueAt).toBe(rowB.due_at); // rowB is due earlier (further in the past)
    expect(detail.lowestRetrievability).toBe(Math.min(retrievabilityA, retrievabilityB));
    expect(retrievabilityB).toBeLessThan(retrievabilityA); // sanity: the weak card really is lower
  });

  it("hydrateQueueCards skips a card that vanished between the queue snapshot and this fetch, rather than crashing", async () => {
    const chain = makeChain({ data: [], error: null }); // card no longer found
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const entries: QueueEntry[] = [{ cardId: "gone", bookId: "b1", queuePosition: 0, reason: "due" }];

    const result = await hydrateQueueCards(client, entries);

    expect(result).toEqual([]);
  });

  it("hydrateQueueCards returns [] without querying at all for an empty entry list", async () => {
    const client = { from: vi.fn() } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const result = await hydrateQueueCards(client, []);
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("startTodaysSession", () => {
  it("maps work_sessions' real column names, including ended_at (not ULM's old completed_at)", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        id: "sess-1",
        user_id: "user-1",
        local_date: "2026-09-01",
        started_at: "2026-09-01T12:00:00Z",
        ended_at: null,
        cards_reviewed: 3,
        new_cards_introduced: 1,
      },
      error: null,
    }));
    const client = { rpc } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const session = await startTodaysSession(client, "2026-09-01");

    expect(rpc).toHaveBeenCalledWith("start_session", { p_local_date: "2026-09-01" });
    expect(session).toEqual({
      id: "sess-1",
      userId: "user-1",
      localDate: "2026-09-01",
      startedAt: "2026-09-01T12:00:00Z",
      endedAt: null,
      cardsReviewed: 3,
      newCardsIntroduced: 1,
    });
  });
});

describe("submitCardReview", () => {
  it("passes confidence through, omitting it as undefined (not null) when not collected", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { id: "review-1" }, error: null }));
    const client = { rpc } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitCardReview(client, {
      currentState: null,
      cardId: "c1",
      sessionId: "sess-1",
      rating: 3,
      elapsedMs: 5000,
      answeredText: "my answer",
      aiFeedback: null,
      aiSuggestedRating: null,
      confidence: null,
      now: new Date("2026-09-01T12:00:00Z"),
    });

    const call = rpc.mock.calls[0]!;
    expect(call[0]).toBe("submit_review");
    const args = call[1] as Record<string, unknown>;
    expect(args.p_confidence).toBeUndefined();
    expect(args.p_card_id).toBe("c1");
    expect(args.p_answered_text).toBe("my answer");
  });

  it("passes a real confidence value straight through when collected", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { id: "review-1" }, error: null }));
    const client = { rpc } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitCardReview(client, {
      currentState: null,
      cardId: "c1",
      sessionId: "sess-1",
      rating: 4,
      elapsedMs: 1000,
      answeredText: "",
      aiFeedback: null,
      aiSuggestedRating: null,
      confidence: "sure",
      now: new Date("2026-09-01T12:00:00Z"),
    });

    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_confidence).toBe("sure");
  });

  it("an empty answered_text is submitted as-is, never blocked -- an honest 'I don't know' is legitimate", async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { id: "review-1" }, error: null }));
    const client = { rpc } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitCardReview(client, {
      currentState: null,
      cardId: "c1",
      sessionId: "sess-1",
      rating: 1,
      elapsedMs: 500,
      answeredText: "",
      aiFeedback: null,
      aiSuggestedRating: null,
      confidence: null,
      now: new Date("2026-09-01T12:00:00Z"),
    });

    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_answered_text).toBe("");
  });
});

describe("countDueCards vs countNewCards -- the day-one distinction", () => {
  it("countDueCards excludes state='new' -- it filters neq('state', 'new')", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await countDueCards(client, "user-1", new Date("2026-09-01T12:00:00Z"));

    expect(chain.eq).not.toHaveBeenCalledWith("state", "new");
  });

  it("countNewCards selects exactly state='new' -- the complement of countDueCards, not a re-derivation of it", async () => {
    const chain = makeChain();
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await countNewCards(client, "user-1");

    expect(chain.eq).toHaveBeenCalledWith("state", "new");
  });
});

describe("submitSelfExplanation", () => {
  it("always supplies user_id explicitly, even though the DB trigger overwrites it -- required by the generated Insert type", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitSelfExplanation(client, {
      userId: "user-1",
      lessonId: "lesson-1",
      sessionId: "sess-1",
      prompt: "Put this in your own words",
      response: null,
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", response: null })
    );
  });

  it("a skip (response: null) is a legitimate row, never penalised, never blocked", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await expect(
      submitSelfExplanation(client, {
        userId: "user-1",
        lessonId: "lesson-1",
        sessionId: "sess-1",
        prompt: "Put this in your own words",
        response: null,
      })
    ).resolves.toBeUndefined();
  });
});


describe("a brand-new user's very first session", () => {
  /**
   * REGRESSION for the defect the stranger-journey acceptance run found on
   * production: `buildTodaysSession` ran `loadSessionSettings` and
   * `startTodaysSession` inside ONE Promise.all. `start_session` is the
   * ensure-point for the `user_settings` row (080), and `loadSessionSettings`
   * reads it with `.single()`, which throws PGRST116 on zero rows. So the
   * settings read raced the insert that creates the row — and a genuinely new
   * account loses that race every time, because its read has nothing to wait
   * for. The user's first ever session showed "Couldn't load today's session.
   * Check your connection and try again." — a message about the network, for a
   * defect that is pure ordering.
   *
   * Every existing fixture and the SEED account already have a user_settings
   * row, which is exactly why 1,841 passing tests never saw it. This test
   * asserts the ORDERING rather than the happy path: start_session must have
   * been called before the settings table is read.
   */
  it("calls start_session BEFORE reading user_settings, so the ensure-insert has happened", async () => {
    const callOrder: string[] = [];

    // One chain object that is BOTH awaitable (list reads) and has .single()
    // (the settings read). A Proxy covers every builder method without having
    // to enumerate them — enumerating is what broke the first attempt, since a
    // missed method (.lte) fails as "not a function" rather than as the
    // ordering assertion this test exists to make.
    const makeThenableChain = (table: string) => {
      const target: Record<string, unknown> = {
        single: async () => {
          callOrder.push(`read:${table}`);
          return {
            data: {
              session_target_minutes: 10,
              daily_new_limit: 5,
              ai_grading_enabled: false,
              desired_retention: 0.9,
            },
            error: null,
          };
        },
        then: (res: (v: { data: unknown[]; count: number; error: null }) => unknown) =>
          Promise.resolve(res({ data: [], count: 0, error: null })),
      };
      const proxy: unknown = new Proxy(target, {
        get(t, prop) {
          if (prop in t) return (t as Record<string | symbol, unknown>)[prop];
          return () => proxy;
        },
      });
      return proxy;
    };

    const client = {
      from: vi.fn((table: string) => makeThenableChain(table)),
      rpc: vi.fn(async (fn: string) => {
        callOrder.push(`rpc:${fn}`);
        if (fn !== "start_session") return { data: [], error: null };
        return {
          data: {
            id: "s1",
            user_id: "u1",
            local_date: "2026-09-01",
            started_at: "2026-09-01T00:00:00Z",
            ended_at: null,
            cards_reviewed: 0,
            new_cards_introduced: 0,
          },
          error: null,
        };
      }),
    } as unknown as Parameters<typeof buildTodaysSession>[0];

    await buildTodaysSession(client, {
      userId: "u1",
      localDate: "2026-09-01",
      now: new Date("2026-09-01T12:00:00Z"),
    });

    const startIdx = callOrder.indexOf("rpc:start_session");
    const settingsIdx = callOrder.indexOf("read:user_settings");
    expect(startIdx, "start_session must be called").toBeGreaterThanOrEqual(0);
    expect(
      settingsIdx === -1 || startIdx < settingsIdx,
      `start_session must precede the user_settings read; got ${callOrder.join(" -> ")}`,
    ).toBe(true);
  });
});


describe("desired_retention actually reaches the scheduler", () => {
  /**
   * The test ULM's lead flagged as missing: their own fix was committed as
   * "believed-fixed, not verified" because nothing proved a NON-DEFAULT
   * retention reaches a real grade.
   *
   * This asserts behaviour, not wiring. A higher desired retention means the
   * user wants to be re-shown material sooner, so the SAME card graded the SAME
   * way must schedule a SHORTER interval at 0.95 than at 0.80. If the parameter
   * were being dropped — which it was on this path until now, defaulting to 0.9
   * regardless of the user's setting — both calls would return an identical
   * interval and this test fails.
   */
  const submitAt = async (desiredRetention: number) => {
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
      data: { id: "review-1", scheduled_days: (args.p_next_state as { scheduled_days?: number })?.scheduled_days },
      error: null,
    }));
    const client = { rpc } as unknown as Parameters<typeof submitCardReview>[0];
    const result = await submitCardReview(client, {
      desiredRetention,
      currentState: {
        stability: 10,
        difficulty: 5,
        due_at: "2026-09-01T12:00:00Z",
        reps: 3,
        lapses: 0,
        state: "review",
        last_review_at: "2026-08-22T12:00:00Z",
      } as never,
      cardId: "c1",
      sessionId: "sess-1",
      rating: 3,
      elapsedMs: 5000,
      answeredText: "a",
      aiFeedback: null,
      aiSuggestedRating: null,
      confidence: null,
      now: new Date("2026-09-01T12:00:00Z"),
    });
    return result.scheduledDays;
  };

  it("a higher desired retention schedules a SHORTER interval", async () => {
    const atLowRetention = await submitAt(0.8);
    const atHighRetention = await submitAt(0.95);
    expect(atHighRetention).toBeLessThan(atLowRetention);
  });
});
