import { describe, expect, it, vi } from "vitest";
// P3-20: submitCardReview/submitQuestionReview now look up the caller's own
// tuned FSRS weights on every call -- mocked here so these tests (which
// exercise the RPC-submission behavior, not the tuning lookup) don't need
// a real `.from("fsrs_user_parameters")` chain on every fake client below.
// lib/self-mastery/__tests__/fsrs-tuning.test.ts covers getUserFsrsWeights
// itself.
vi.mock("@/lib/self-mastery/fsrs-tuning", () => ({
  getUserFsrsWeights: vi.fn(async () => undefined),
}));
import {
  hydrateQueueCards,
  fetchCardAnswer,
  fetchLessonContext,
  fetchDueCardDetail,
  startTodaysSession,
  submitCardReview,
  submitSelfExplanation,
  recordTeachBackUsage,
  countDueCards,
  countNewCards,
} from "../build-session";
import { buildTodaysSession } from "../build-session";
import { cardRetrievability } from "@/lib/self-mastery/memory-strength";
import type { QueueEntry } from "../types";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "lte", "in", "single", "insert", "update"]) {
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
    update: ReturnType<typeof vi.fn>;
  };
}

describe("the non-negotiable invariant: the answer must never reach the client before commit", () => {
  it("hydrateQueueCards' select() names id/lesson_id/prompt_type/prompt and NEVER answer", async () => {
    const chain = makeChain({ data: [{ id: "c1", lesson_id: "l1", prompt_type: "free_recall", prompt: "recall this" }], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const entries: QueueEntry[] = [{ cardId: "c1", questionId: null, bookId: "b1", queuePosition: 0, reason: "due" }];

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

  it("hydrateQueueCards THROWS (never silently shrinks) when a card vanished between the queue snapshot and this fetch", async () => {
    // Opus architect's red-team of #24 (2026-09): the previous behaviour here
    // was `if (!row) continue` -- a session that should have had N cards
    // quietly became one with fewer, with nothing in the UI or logs to say
    // why. Corrected to throw, verified here rather than merely asserted in
    // a comment.
    const chain = makeChain({ data: [], error: null }); // card no longer found
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const entries: QueueEntry[] = [{ cardId: "gone", questionId: null, bookId: "b1", queuePosition: 0, reason: "due" }];

    await expect(hydrateQueueCards(client, entries)).rejects.toThrow(/refusing to silently shrink/);
  });

  it("hydrateQueueCards THROWS if handed a question-backed entry (cardId null) instead of being silently no-op", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
    const entries: QueueEntry[] = [{ cardId: null, questionId: "q1", bookId: null, queuePosition: 0, reason: "due" }];

    await expect(hydrateQueueCards(client, entries)).rejects.toThrow(/has no cardId/);
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
      userId: "user-1",
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
      userId: "user-1",
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
      userId: "user-1",
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
    const chain = makeChain({ data: { id: "se-1", created_at: "2026-09-08T12:00:00Z" }, error: null });
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

  it("a skip (response: null) is a legitimate row, never penalised, never blocked -- and returns the real inserted id/created_at, never void", async () => {
    const chain = makeChain({ data: { id: "se-1", created_at: "2026-09-08T12:00:00Z" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await expect(
      submitSelfExplanation(client, {
        userId: "user-1",
        lessonId: "lesson-1",
        sessionId: "sess-1",
        prompt: "Put this in your own words",
        response: null,
      })
    ).resolves.toEqual({ id: "se-1", createdAt: "2026-09-08T12:00:00Z" });
  });

  it("sessionId is nullable -- an MCP-logged reflection has no app-tracked work_sessions row to attribute it to", async () => {
    const chain = makeChain({ data: { id: "se-2", created_at: "2026-09-08T12:00:00Z" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as Parameters<typeof hydrateQueueCards>[0];

    const result = await submitSelfExplanation(client, {
      userId: "user-1",
      lessonId: "lesson-1",
      sessionId: null,
      prompt: "Reflect",
      response: "My own words",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: null }));
    expect(result).toEqual({ id: "se-2", createdAt: "2026-09-08T12:00:00Z" });
  });

  // P3-03: "draft" is one of the six named study-method-modes taxonomy ids
  // (lib/self-mastery/study-methods.ts) -- recorded on work_sessions.study_methods
  // only for a real, non-skipped, session-attached submission.
  it("records 'draft' in work_sessions.study_methods on a real, session-attached submission", async () => {
    const seChain = makeChain({ data: { id: "se-3", created_at: "2026-09-08T12:00:00Z" }, error: null });
    const wsChain = makeChain({ data: { study_methods: ["retrieval"] }, error: null });
    const client = {
      from: vi.fn((table: string) => (table === "work_sessions" ? wsChain : seChain)),
    } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitSelfExplanation(client, {
      userId: "user-1",
      lessonId: "lesson-1",
      sessionId: "sess-1",
      prompt: "Put this in your own words",
      response: "A real explanation",
    });

    expect(wsChain.update).toHaveBeenCalledWith({ study_methods: ["retrieval", "draft"] });
  });

  it("does NOT record 'draft' on a skip (response: null), even with a session attached -- a skip is not a draft", async () => {
    const seChain = makeChain({ data: { id: "se-4", created_at: "2026-09-08T12:00:00Z" }, error: null });
    const wsChain = makeChain({ data: { study_methods: [] }, error: null });
    const client = {
      from: vi.fn((table: string) => (table === "work_sessions" ? wsChain : seChain)),
    } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitSelfExplanation(client, {
      userId: "user-1",
      lessonId: "lesson-1",
      sessionId: "sess-1",
      prompt: "Put this in your own words",
      response: null,
    });

    expect(wsChain.update).not.toHaveBeenCalled();
  });

  it("does NOT re-write study_methods when 'draft' is already recorded -- union, not append", async () => {
    const seChain = makeChain({ data: { id: "se-5", created_at: "2026-09-08T12:00:00Z" }, error: null });
    const wsChain = makeChain({ data: { study_methods: ["retrieval", "draft"] }, error: null });
    const client = {
      from: vi.fn((table: string) => (table === "work_sessions" ? wsChain : seChain)),
    } as unknown as Parameters<typeof hydrateQueueCards>[0];

    await submitSelfExplanation(client, {
      userId: "user-1",
      lessonId: "lesson-1",
      sessionId: "sess-1",
      prompt: "Put this in your own words",
      response: "Another real explanation",
    });

    expect(wsChain.update).not.toHaveBeenCalled();
  });
});

// P3-03: "recite" (Teach-Back mode) was named `status: "active"` in
// study-methods.ts with a real implementedAt citation, but nothing ever
// called recordStudyMethods with it -- evaluateTeachBack
// (lib/self-mastery/teach-back.ts) is deliberately ephemeral (no
// persistence of its own) and Teach-Back mode is deliberately standalone
// from this file's retrieval overlay (components/self-mastery/
// teach-back-panel.tsx's own header), so it never had a sessionId to
// attribute "recite" to the way submitSelfExplanation's "draft" does.
// recordTeachBackUsage is the bridge: ensures today's session exists
// (startTodaysSession -- the same idempotent resume-or-create RPC
// buildTodaysSession itself calls) and tags "recite" onto it.
describe("P3-03: recordTeachBackUsage records 'recite' via today's session", () => {
  function makeClient(opts: { rpcData: Record<string, unknown>; wsChain: ReturnType<typeof makeChain> }) {
    const rpc = vi.fn(async () => ({ data: opts.rpcData, error: null }));
    return { rpc, from: vi.fn(() => opts.wsChain) } as unknown as Parameters<typeof hydrateQueueCards>[0];
  }

  const RPC_SESSION_ROW = {
    id: "sess-teach-1",
    user_id: "user-1",
    local_date: "2026-09-18",
    started_at: "2026-09-18T12:00:00Z",
    ended_at: null,
    cards_reviewed: 0,
    new_cards_introduced: 0,
  };

  it("ensures today's session exists and records 'recite' on work_sessions.study_methods", async () => {
    const wsChain = makeChain({ data: { study_methods: ["retrieval"] }, error: null });
    const client = makeClient({ rpcData: RPC_SESSION_ROW, wsChain });

    await recordTeachBackUsage(client, "2026-09-18");

    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("start_session", { p_local_date: "2026-09-18" });
    expect(wsChain.update).toHaveBeenCalledWith({ study_methods: ["retrieval", "recite"] });
  });

  it("does NOT re-write study_methods when 'recite' is already recorded -- union, not append", async () => {
    const wsChain = makeChain({ data: { study_methods: ["retrieval", "recite"] }, error: null });
    const client = makeClient({ rpcData: RPC_SESSION_ROW, wsChain });

    await recordTeachBackUsage(client, "2026-09-18");

    expect(wsChain.update).not.toHaveBeenCalled();
  });
});

describe("P3-03: buildTodaysSession records which study methods it actually used", () => {
  /**
   * A full buildTodaysSession-compatible client whose get_session_queue RPC
   * returns real, caller-supplied entries (every prior buildTodaysSession
   * fixture in this file used an empty queue, which never exercises the new
   * recordStudyMethods call at all -- these are the first that do).
   */
  function makeClient(opts: {
    entries: { cardId: string | null; questionId: string | null; bookId: string | null; queuePosition: number; reason: "due" | "new" | "warm_up" }[];
    cardsRows: { id: string; lesson_id: string; prompt_type: string; prompt: string }[];
    questionsRows?: { id: string; class_id: string; prompt: string }[];
  }) {
    const studyMethodsUpdates: { study_methods: string[] }[] = [];
    const makeTableChain = (table: string) => {
      const target: Record<string, unknown> = {
        single: async () => {
          if (table === "user_settings") {
            return { data: { session_target_minutes: 10, daily_new_limit: 10_000, ai_grading_enabled: false, desired_retention: 0.9 }, error: null };
          }
          if (table === "work_sessions") {
            return { data: { study_methods: [] }, error: null };
          }
          return { data: null, error: null };
        },
        then: (res: (v: { data: unknown[]; count: number; error: null }) => unknown) => {
          if (table === "cards") return Promise.resolve(res({ data: opts.cardsRows, count: opts.cardsRows.length, error: null }));
          if (table === "questions") return Promise.resolve(res({ data: opts.questionsRows ?? [], count: (opts.questionsRows ?? []).length, error: null }));
          return Promise.resolve(res({ data: [], count: 0, error: null }));
        },
        update: (payload: { study_methods: string[] }) => {
          if (table === "work_sessions") studyMethodsUpdates.push(payload);
          return proxy;
        },
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
      from: vi.fn((table: string) => makeTableChain(table)),
      rpc: vi.fn(async (fn: string) => {
        if (fn === "start_session") {
          return {
            data: { id: "s1", user_id: "u1", local_date: "2026-09-14", started_at: "2026-09-14T00:00:00Z", ended_at: null, cards_reviewed: 0, new_cards_introduced: 0 },
            error: null,
          };
        }
        if (fn === "get_session_queue") {
          return {
            data: opts.entries.map((e) => ({ card_id: e.cardId, question_id: e.questionId, book_id: e.bookId, queue_position: e.queuePosition, reason: e.reason })),
            error: null,
          };
        }
        return { data: [], error: null };
      }),
    } as unknown as Parameters<typeof buildTodaysSession>[0];

    return { client, studyMethodsUpdates };
  }

  const run = (opts: Parameters<typeof makeClient>[0]) => {
    const { client, studyMethodsUpdates } = makeClient(opts);
    return buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") }).then(() => studyMethodsUpdates);
  };

  it("records only 'retrieval' for a single-book session", async () => {
    const updates = await run({
      entries: [
        { cardId: "c1", questionId: null, bookId: "book-a", queuePosition: 0, reason: "due" },
        { cardId: "c2", questionId: null, bookId: "book-a", queuePosition: 1, reason: "due" },
      ],
      cardsRows: [
        { id: "c1", lesson_id: "l1", prompt_type: "free_recall", prompt: "p1" },
        { id: "c2", lesson_id: "l2", prompt_type: "free_recall", prompt: "p2" },
      ],
    });
    expect(updates).toEqual([{ study_methods: ["retrieval"] }]);
  });

  it("records 'retrieval' AND 'interleave' when the plan spans more than one book", async () => {
    const updates = await run({
      entries: [
        { cardId: "c1", questionId: null, bookId: "book-a", queuePosition: 0, reason: "due" },
        { cardId: "c2", questionId: null, bookId: "book-b", queuePosition: 1, reason: "due" },
      ],
      cardsRows: [
        { id: "c1", lesson_id: "l1", prompt_type: "free_recall", prompt: "p1" },
        { id: "c2", lesson_id: "l2", prompt_type: "free_recall", prompt: "p2" },
      ],
    });
    expect(updates).toEqual([{ study_methods: ["retrieval", "interleave"] }]);
  });

  it("records 'interleave' when cards and cross-domain questions both appear, even from a single book", async () => {
    const updates = await run({
      entries: [
        { cardId: "c1", questionId: null, bookId: "book-a", queuePosition: 0, reason: "due" },
        { cardId: null, questionId: "q1", bookId: null, queuePosition: 1, reason: "due" },
      ],
      cardsRows: [{ id: "c1", lesson_id: "l1", prompt_type: "free_recall", prompt: "p1" }],
      questionsRows: [{ id: "q1", class_id: "class-1", prompt: "q-prompt" }],
    });
    expect(updates).toEqual([{ study_methods: ["retrieval", "interleave"] }]);
  });

  it("writes nothing when the queue is empty -- never fabricates a technique that didn't happen", async () => {
    const updates = await run({ entries: [], cardsRows: [] });
    expect(updates).toEqual([]);
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
      userId: "user-1",
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

describe("Phase 1 #27 -- exam intensity wiring in buildTodaysSession", () => {
  /**
   * Builds a full buildTodaysSession-compatible client. `classAssessmentRows`
   * feeds loadNearestUpcomingExamsByClass; everything else defaults to an
   * empty/zero shape (SEED_MS_PER_CARD's 20s pace applies with zero review
   * history, so capacity is deterministic and computable by hand for the
   * assertions below). The get_session_queue RPC call is captured so this
   * test can assert on the ACTUAL p_limit_due/p_limit_new sent -- the one
   * observable side effect of the capacity math, since BuiltSession itself
   * doesn't expose capacity directly.
   */
  function makeSessionClient(classAssessmentRows: { class_id: string; date: string; type: string; name: string }[], sessionTargetMinutes: number) {
    const queueCalls: { p_limit_due: number; p_limit_new: number }[] = [];
    const makeThenableChain = (table: string) => {
      const target: Record<string, unknown> = {
        single: async () => {
          if (table === "user_settings") {
            return {
              // daily_new_limit is deliberately huge: totalDueCount is 0 in this
              // fixture (empty card_states), so allocateQueueLimits would otherwise
              // cap limitNew at a small daily_new_limit long before capacity itself
              // does, hiding the very capacity math these tests assert on.
              data: { session_target_minutes: sessionTargetMinutes, daily_new_limit: 10_000, ai_grading_enabled: false, desired_retention: 0.9 },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (res: (v: { data: unknown[]; count: number; error: null }) => unknown) => {
          if (table === "class_assessments") return Promise.resolve(res({ data: classAssessmentRows, count: classAssessmentRows.length, error: null }));
          // reviews (elapsed_ms history), card_states (due/new counts) -- all empty:
          // zero due, zero history, SEED_MS_PER_CARD's 20s/card pace applies.
          return Promise.resolve(res({ data: [], count: 0, error: null }));
        },
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
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn === "start_session") {
          return {
            data: { id: "s1", user_id: "u1", local_date: "2026-09-14", started_at: "2026-09-14T00:00:00Z", ended_at: null, cards_reviewed: 0, new_cards_introduced: 0 },
            error: null,
          };
        }
        if (fn === "get_session_queue") {
          queueCalls.push(args as { p_limit_due: number; p_limit_new: number });
          return { data: [], error: null };
        }
        return { data: [], error: null };
      }),
    } as unknown as Parameters<typeof buildTodaysSession>[0];

    return { client, queueCalls };
  }

  // SEED_MS_PER_CARD = 20_000ms (20s/card, zero review history). At a 10-minute
  // target: 600_000ms / 20_000ms = 30 cards baseline.
  it("scales capacity up when an exam is imminent for the user's only class", async () => {
    const { client, queueCalls } = makeSessionClient(
      [{ class_id: "c1", date: "2026-09-15", type: "exam", name: "Midterm" }], // 1 day away -> 3.0x
      10
    );
    const result = await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    const totalLimit = queueCalls[0]!.p_limit_due + queueCalls[0]!.p_limit_new;
    // baseline 30 * 3.0 = 90, but the absolute ceiling (20 min / 20s = 60) caps it.
    expect(totalLimit).toBe(60);
    // The effect was real and silent -- BuiltSession.examIntensity is what
    // finally names it for the UI (retrieval-session-overlay.tsx), without
    // this test's own capacity math above being its only observable trace.
    expect(result.examIntensity).toEqual({ daysUntilExam: 1, multiplier: 3.0, assessmentName: "Midterm", assessmentType: "exam" });
  });

  it("uses the MAX multiplier across classes, never a product of several -- three imminent exams must not compound", async () => {
    const { client, queueCalls } = makeSessionClient(
      [
        { class_id: "c1", date: "2026-09-15", type: "exam", name: "Exam 1" }, // 1 day -> 3.0x
        { class_id: "c2", date: "2026-09-16", type: "final_midterm", name: "Exam 2" }, // 2 days -> 2.5x
        { class_id: "c3", date: "2026-09-17", type: "exam", name: "Exam 3" }, // 3 days -> 2.5x
      ],
      10
    );
    await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    const totalLimit = queueCalls[0]!.p_limit_due + queueCalls[0]!.p_limit_new;
    // If multipliers compounded (3.0*2.5*2.5=18.75x -> 562 cards), the ceiling would
    // still cap it at 60 -- so this alone can't distinguish MAX from a product. The
    // real assertion is in the next test, at a target small enough that the ceiling
    // never binds and a product WOULD be observable if it were happening.
    expect(totalLimit).toBeLessThanOrEqual(60);
  });

  it("MAX, not product, is directly observable at a low session target where the ceiling never binds", async () => {
    // 1-minute target: 60_000ms / 20_000ms = 3 cards baseline. Ceiling at 20 min =
    // 60 cards, far above anything this test reaches, so it never binds here.
    const { client, queueCalls } = makeSessionClient(
      [
        { class_id: "c1", date: "2026-09-15", type: "exam", name: "Exam 1" }, // 1 day -> 3.0x
        { class_id: "c2", date: "2026-09-16", type: "final_midterm", name: "Exam 2" }, // 2 days -> 2.5x
      ],
      1
    );
    await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    const totalLimit = queueCalls[0]!.p_limit_due + queueCalls[0]!.p_limit_new;
    // MAX(3.0, 2.5) = 3.0 -> floor(3 * 3.0) = 9. A product (3.0*2.5=7.5) would give
    // floor(3*7.5)=22 instead -- these are far enough apart that either bug would fail
    // this assertion, not just round differently.
    expect(totalLimit).toBe(9);
  });

  it("applies the absolute ceiling even under extreme intensity — never an open-ended cram session", async () => {
    const { client, queueCalls } = makeSessionClient(
      [{ class_id: "c1", date: "2026-09-14", type: "exam", name: "Exam today" }], // 0 days away -> 3.0x, the curve's max
      60 // a 60-minute target would otherwise yield 180 cards at baseline
    );
    await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    const totalLimit = queueCalls[0]!.p_limit_due + queueCalls[0]!.p_limit_new;
    // Ceiling: 20 min / 20s per card = 60 cards, regardless of the 60-min target or
    // the 3x multiplier that would otherwise demand 540.
    expect(totalLimit).toBe(60);
  });

  it("does not scale capacity at all when no class has an upcoming exam-type assessment", async () => {
    const { client, queueCalls } = makeSessionClient([], 10);
    const result = await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    const totalLimit = queueCalls[0]!.p_limit_due + queueCalls[0]!.p_limit_new;
    expect(totalLimit).toBe(30); // baseline only, multiplier 1.0
    expect(result.examIntensity).toBeNull();
  });

  it("names the MOST URGENT class's assessment as the driving one when several classes have exams -- matching the MAX, never a blend of several", async () => {
    const { client } = makeSessionClient(
      [
        { class_id: "c1", date: "2026-09-15", type: "exam", name: "Exam 1" }, // 1 day -> 3.0x
        { class_id: "c2", date: "2026-09-16", type: "final_midterm", name: "Exam 2" }, // 2 days -> 2.5x
      ],
      10
    );
    const result = await buildTodaysSession(client, { userId: "u1", localDate: "2026-09-14", now: new Date("2026-09-14T12:00:00Z") });

    expect(result.examIntensity).toEqual({ daysUntilExam: 1, multiplier: 3.0, assessmentName: "Exam 1", assessmentType: "exam" });
  });
});
