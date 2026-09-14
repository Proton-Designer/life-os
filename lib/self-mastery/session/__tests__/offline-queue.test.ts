import { describe, expect, it, vi } from "vitest";
import { enqueuePendingReview, loadPendingReviews, replayPendingReviews, type PendingReview } from "../offline-queue";
import type { createClient } from "@/lib/supabase/client";

function inMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  };
}

function pendingReview(
  overrides: Partial<Omit<PendingReview, "queuedAt" | "attempts">> = {},
): Omit<PendingReview, "queuedAt" | "attempts"> {
  return {
    id: "review-1",
    cardId: "card-1",
    rating: 3,
    elapsedMs: 4000,
    answeredText: "my answer",
    aiFeedback: null,
    aiSuggestedRating: null,
    confidence: null,
    nextState: { reps: 1, stability: 2, difficulty: 5, due_at: "2026-08-20T00:00:00.000Z", state: "learning", learning_steps: 1 },
    ...overrides,
  };
}

interface ReviewsRow {
  rating: number;
  confidence: string | null;
  elapsed_ms: number;
  answered_text: string | null;
}

function rpcClient(
  handler: (cardId: string) => { data: unknown; error: { message: string; code?: string } | null },
  /** Backs `wasAlreadyApplied`'s `.from("reviews")...` lookup. Return `null` for "no row found". */
  reviewsLookup: (cardId: string) => ReviewsRow | null = () => null,
) {
  const calledCardIds: string[] = [];
  const calledArgs: Record<string, unknown>[] = [];
  const reviewsLookupCardIds: string[] = [];
  const rpc = vi.fn(async (_fn: string, args: { p_card_id: string }) => {
    calledCardIds.push(args.p_card_id);
    calledArgs.push(args);
    return handler(args.p_card_id);
  });

  const from = vi.fn((table: string) => {
    if (table !== "reviews") throw new Error(`test double doesn't support .from("${table}")`);
    let cardId = "";
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((_col: string, value: string) => {
        cardId = value;
        return chain;
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        reviewsLookupCardIds.push(cardId);
        return { data: reviewsLookup(cardId), error: null };
      }),
    };
    return chain;
  });

  return {
    client: { rpc, from } as unknown as ReturnType<typeof createClient>,
    calledCardIds,
    calledArgs,
    reviewsLookupCardIds,
  };
}

describe("enqueuePendingReview / loadPendingReviews", () => {
  it("stores and reloads a review", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview());
    const loaded = await loadPendingReviews(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.cardId).toBe("card-1");
  });

  it("preserves insertion order across multiple enqueues", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-b" }));
    await enqueuePendingReview(storage, pendingReview({ id: "c", cardId: "card-c" }));
    const loaded = await loadPendingReviews(storage);
    const sorted = [...loaded].sort((x, y) => x.queuedAt - y.queuedAt);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array when storage is corrupt or empty", async () => {
    const storage = inMemoryStorage();
    await storage.setItem("self-mastery.session.offline-review-queue.v1", "not json{{{");
    expect(await loadPendingReviews(storage)).toEqual([]);
  });
});

describe("replayPendingReviews", () => {
  it("replays in queued order and clears successfully replayed items", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-b" }));

    const { client, calledCardIds } = rpcClient((cardId) => ({ data: { id: `review-for-${cardId}` }, error: null }));
    const result = await replayPendingReviews(client, storage, "sess-current");

    expect(calledCardIds).toEqual(["card-a", "card-b"]);
    expect(result.succeeded).toEqual(["a", "b"]);
    expect(result.failures).toEqual([]);
    expect(await loadPendingReviews(storage)).toEqual([]);
  });

  it("uses the CURRENT sessionId passed to replayPendingReviews, not a session id captured at enqueue time", async () => {
    // Adaptation 3 (file header): a review queued before a relaunch or a multi-day
    // offline gap must not carry a stale session id — the caller resolves today's
    // real session immediately before calling replay, and every item in the pass
    // gets attributed to it.
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));

    const { client, calledArgs } = rpcClient(() => ({ data: { id: "review-a" }, error: null }));
    await replayPendingReviews(client, storage, "sess-resolved-at-replay-time");

    expect(calledArgs[0]?.["p_session_id"]).toBe("sess-resolved-at-replay-time");
  });

  it("passes p_confidence, using undefined (not null) when the review has no calibration tap", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a", confidence: null }));
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-b", confidence: "sure" }));

    const { client, calledArgs } = rpcClient(() => ({ data: { id: "review-x" }, error: null }));
    await replayPendingReviews(client, storage, "sess-1");

    expect(calledArgs[0]?.["p_confidence"]).toBeUndefined();
    expect(calledArgs[1]?.["p_confidence"]).toBe("sure");
  });

  it("PERMANENT failure (poison pill): drops the offending item but still attempts every other card — never blocks good writes", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-b" }));
    await enqueuePendingReview(storage, pendingReview({ id: "c", cardId: "card-c" }));

    const { client, calledCardIds } = rpcClient((cardId) =>
      cardId === "card-b"
        ? { data: null, error: { message: "submit_review: no card_states row for card card-b / user u1" } }
        : { data: { id: `review-for-${cardId}` }, error: null },
    );

    const result = await replayPendingReviews(client, storage, "sess-1");

    // The whole poison-pill point: card-c is still attempted even though card-b (which
    // sorts before it) failed permanently.
    expect(calledCardIds).toEqual(["card-a", "card-b", "card-c"]);
    expect(result.succeeded).toEqual(["a", "c"]);
    expect(result.failures).toEqual([
      { id: "b", cardId: "card-b", error: "submit_review: no card_states row for card card-b / user u1", classification: "permanent" },
    ]);

    // Permanent failure is dropped from the queue entirely -- not retried forever.
    const remaining = await loadPendingReviews(storage);
    expect(remaining).toEqual([]);
  });

  it("classifies every submit_review exception message as permanent — completeness pass against the LIVE function, not ULM's original", async () => {
    // supabase/migrations/078_ulm_start_session_submit_review.sql, as extended by
    // 081 and 085 -- verified against pg_get_functiondef on the scratch DB,
    // 2026-09-01, not copied from ULM's original schema. "book for card % has been
    // deleted" (081's soft-delete guard) is the one message ULM's original list
    // never had -- see this suite's next test for why that specifically matters.
    const messages = [
      "submit_review: no authenticated user",
      "submit_review: rating must be 1..4",
      "submit_review: no card_states row for card abc / user xyz",
      "submit_review: book for card abc has been deleted",
      "submit_review: reps must increase by exactly 1 (was 2, proposed 4)",
      "submit_review: stability must be > 0 (proposed -1)",
      "submit_review: due_at must be in the future (proposed 2020-01-01T00:00:00Z)",
      "submit_review: state is required",
      "submit_review: illegal transition new -> new",
    ];
    for (const message of messages) {
      const storage = inMemoryStorage();
      await enqueuePendingReview(storage, pendingReview({ id: "x", cardId: "card-x" }));
      const { client } = rpcClient(() => ({ data: null, error: { message } }));
      const result = await replayPendingReviews(client, storage, "sess-1");
      expect(result.failures[0]?.classification, message).toBe("permanent");
    }
  });

  it("classifies a soft-deleted book's card (081's guard) as permanent, not transient — the message ULM's classifier never had to cover", async () => {
    // A naive port of ULM's isPermanentFailure list would let this fall through to
    // the transient default and retry MAX_TRANSIENT_ATTEMPTS times against a book
    // that stays deleted -- the exact poison-pill bug this file exists to prevent,
    // reintroduced by porting from a stale (pre-081) source.
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "x", cardId: "card-x" }));
    const { client } = rpcClient(() => ({
      data: null,
      error: { message: "submit_review: book for card card-x has been deleted" },
    }));
    const result = await replayPendingReviews(client, storage, "sess-1");
    expect(result.failures[0]?.classification).toBe("permanent");
    expect(await loadPendingReviews(storage)).toEqual([]); // dropped, not retried forever
  });

  it("recovers a lost response: reps-mismatch + a matching reviews row is treated as succeeded, not a failure", async () => {
    // Found by ow9rlnds's adversarial review, 2026-09-01: an RPC call that
    // actually succeeded server-side but whose response was lost (network drop
    // right after commit) gets retried and correctly fails the reps+1 check --
    // this proves it's then correctly recognized as already-landed, not shown
    // to the user as a real failure.
    const storage = inMemoryStorage();
    await enqueuePendingReview(
      storage,
      pendingReview({ id: "x", cardId: "card-x", rating: 3, elapsedMs: 4000, confidence: "sure", answeredText: "my answer" }),
    );
    const { client } = rpcClient(
      () => ({ data: null, error: { message: "submit_review: reps must increase by exactly 1 (was 1, proposed 2)" } }),
      (cardId) =>
        cardId === "card-x" ? { rating: 3, confidence: "sure", elapsed_ms: 4000, answered_text: "my answer" } : null,
    );
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.succeeded).toEqual(["x"]);
    expect(result.recoveredLostResponses).toEqual(["x"]);
    expect(result.failures).toEqual([]); // not surfaced to the user as a failure
    expect(await loadPendingReviews(storage)).toEqual([]); // removed from the queue, like a real success
  });

  it("does NOT recover when the reps-mismatch has no matching reviews row (genuine conflict, not a lost response)", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "x", cardId: "card-x" }));
    const { client } = rpcClient(
      () => ({ data: null, error: { message: "submit_review: reps must increase by exactly 1 (was 1, proposed 2)" } }),
      () => null, // no reviews row at all for this card
    );
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.succeeded).toEqual([]);
    expect(result.recoveredLostResponses).toEqual([]);
    expect(result.failures[0]?.classification).toBe("permanent"); // falls through to the normal path
  });

  it("does NOT recover when a reviews row exists for the card but doesn't match this item (a DIFFERENT review landed, not this one)", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "x", cardId: "card-x", rating: 3, elapsedMs: 4000 }));
    const { client } = rpcClient(
      () => ({ data: null, error: { message: "submit_review: reps must increase by exactly 1 (was 1, proposed 2)" } }),
      // Same card, but a different rating -- a genuinely different review, not this queued item.
      (cardId) => (cardId === "card-x" ? { rating: 4, confidence: null, elapsed_ms: 9999, answered_text: "someone else's answer" } : null),
    );
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.succeeded).toEqual([]);
    expect(result.recoveredLostResponses).toEqual([]);
    expect(result.failures[0]?.classification).toBe("permanent");
  });

  it("a recovered lost-response item does NOT block a later item for the same card", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(
      storage,
      pendingReview({ id: "a", cardId: "card-a", rating: 3, elapsedMs: 4000, confidence: null, answeredText: "answer-a" }),
    );
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-a", rating: 4, elapsedMs: 2000 }));

    const { client, calledCardIds } = rpcClient(
      (cardId) =>
        cardId === "card-a" && calledCardIds.filter((c) => c === "card-a").length === 1
          ? { data: null, error: { message: "submit_review: reps must increase by exactly 1 (was 1, proposed 2)" } }
          : { data: { id: `review-for-${cardId}` }, error: null },
      (cardId) =>
        cardId === "card-a" ? { rating: 3, confidence: null, elapsed_ms: 4000, answered_text: "answer-a" } : null,
    );
    const result = await replayPendingReviews(client, storage, "sess-1");

    // Both items for card-a are attempted -- "a" is recovered (verified already
    // applied), and "b" is NOT blocked behind it, unlike a real transient/permanent
    // failure which would block same-card items still in this pass.
    expect(calledCardIds).toEqual(["card-a", "card-a"]);
    expect(result.recoveredLostResponses).toEqual(["a"]);
    expect(result.succeeded).toEqual(["a", "b"]);
  });

  it("classifies a revoked/expired session (PGRST301) as permanent, not transient — L6 §3 finding, ported from ULM", async () => {
    // PostgREST rejects an invalid bearer token BEFORE the RPC ever runs --
    // auth.uid() is never evaluated, so none of submit_review's own exception
    // strings can ever appear. The structured code for this is PGRST301.
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "x", cardId: "card-x" }));
    const { client } = rpcClient(() => ({ data: null, error: { message: "JWT cryptographic operation failed", code: "PGRST301" } }));
    const result = await replayPendingReviews(client, storage, "sess-1");
    expect(result.failures[0]?.classification).toBe("permanent");
  });

  it("TRANSIENT failure: stays queued for retry, and blocks only LATER items for the SAME card, never a different card", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a1", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "a2", cardId: "card-a" })); // same card, queued after a1
    await enqueuePendingReview(storage, pendingReview({ id: "b", cardId: "card-b" })); // different card

    const { client, calledCardIds } = rpcClient((cardId) =>
      cardId === "card-a"
        ? { data: null, error: { message: "Failed to fetch" } } // looks like a network blip
        : { data: { id: `review-for-${cardId}` }, error: null },
    );

    const result = await replayPendingReviews(client, storage, "sess-1");

    // a2 is never even attempted (would violate reps+1 ordering behind a1's failure);
    // b IS attempted and succeeds, because it has no ordering relationship to card-a.
    expect(calledCardIds).toEqual(["card-a", "card-b"]);
    expect(result.succeeded).toEqual(["b"]);
    expect(result.failures).toEqual([
      { id: "a1", cardId: "card-a", error: "Failed to fetch", classification: "transient-retrying" },
    ]);

    const remaining = await loadPendingReviews(storage);
    expect(remaining.map((r) => r.id)).toEqual(["a1", "a2"]); // both still queued, in original order
    expect(remaining.find((r) => r.id === "a1")?.attempts).toBe(1);
  });

  it("a transient failure becomes a dead letter after MAX_TRANSIENT_ATTEMPTS and stops blocking its card", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));

    const { client } = rpcClient(() => ({ data: null, error: { message: "503 Service Unavailable" } }));

    let last;
    for (let i = 0; i < 5; i++) {
      last = await replayPendingReviews(client, storage, "sess-1");
    }

    expect(last!.failures[0]?.classification).toBe("transient-exhausted");
    expect(await loadPendingReviews(storage)).toEqual([]); // dead-lettered, not retried forever
  });

  it("a thrown exception (e.g. fetch itself rejecting) is treated as transient, not permanent", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "a", cardId: "card-a" }));

    const rpc = vi.fn(async () => {
      throw new Error("network request failed");
    });
    const client = { rpc } as unknown as ReturnType<typeof createClient>;

    const result = await replayPendingReviews(client, storage, "sess-1");
    expect(result.failures[0]?.classification).toBe("transient-retrying");
    const remaining = await loadPendingReviews(storage);
    expect(remaining).toHaveLength(1); // still queued, worth retrying
  });
});
describe("question-backed reviews (160/161, #24/#26 -- CollegeOS questions reusing this scheduler)", () => {
  /** Like `rpcClient`, but tracks WHICH rpc function name was called and its full args, so a question item's routing to `submit_question_review` (not `submit_review`) is actually verified, not assumed. */
  function multiRpcClient(
    handlers: Partial<Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message?: string; code?: string } | null }>>,
    reviewsLookup: (column: "card_id" | "question_id", value: string) => ReviewsRow | null = () => null,
  ) {
    const calledFns: string[] = [];
    const calledArgs: Record<string, unknown>[] = [];
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calledFns.push(fn);
      calledArgs.push(args);
      const handler = handlers[fn];
      if (!handler) throw new Error(`test double has no handler for rpc("${fn}")`);
      return handler(args);
    });
    const from = vi.fn((table: string) => {
      if (table !== "reviews") throw new Error(`test double doesn't support .from("${table}")`);
      let column: "card_id" | "question_id" = "card_id";
      let value = "";
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, v: string) => {
          column = col as "card_id" | "question_id";
          value = v;
          return chain;
        }),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: reviewsLookup(column, value), error: null })),
      };
      return chain;
    });
    return { client: { rpc, from } as unknown as ReturnType<typeof createClient>, calledFns, calledArgs };
  }

  it("a question-backed pending item replays through submit_question_review with p_question_id, never submit_review/p_card_id", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(
      storage,
      pendingReview({ id: "q1", cardId: undefined, questionId: "question-a", correct: true, confidence: "sure" }),
    );

    const { client, calledFns, calledArgs } = multiRpcClient({
      submit_question_review: () => ({ data: { id: "review-q1" }, error: null }),
    });
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(calledFns).toEqual(["submit_question_review"]);
    expect(calledArgs[0]).toMatchObject({ p_question_id: "question-a", p_correct: true, p_confidence: "sure" });
    expect(calledArgs[0]).not.toHaveProperty("p_card_id");
    expect(result.succeeded).toEqual(["q1"]);
    expect(result.failures).toEqual([]);
  });

  it("card and question items in the same queue each route to their own RPC, independently", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "c1", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "q1", cardId: undefined, questionId: "question-a" }));

    const { client, calledFns } = multiRpcClient({
      submit_review: () => ({ data: { id: "review-c1" }, error: null }),
      submit_question_review: () => ({ data: { id: "review-q1" }, error: null }),
    });
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(calledFns).toEqual(["submit_review", "submit_question_review"]);
    expect(result.succeeded).toEqual(["c1", "q1"]);
  });

  it("a card failure never blocks a later QUESTION item (independent id spaces, independent blocking)", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "c1", cardId: "card-a" }));
    await enqueuePendingReview(storage, pendingReview({ id: "q1", cardId: undefined, questionId: "question-a" }));

    const { client } = multiRpcClient({
      submit_review: () => ({ data: null, error: { message: "network hiccup" } }), // transient -> blocks later card-a items only
      submit_question_review: () => ({ data: { id: "review-q1" }, error: null }),
    });
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.succeeded).toEqual(["q1"]);
    expect(result.failures[0]?.classification).toBe("transient-retrying");
  });

  it("submit_question_review's 'has been retired' guard classifies as PERMANENT, not transient — a question review must never be retried forever against content that will never un-retire", async () => {
    // This is the exact failure mode #24's red-team flagged: a question
    // review whose errors are NOT recognised by isPermanentFailure would be
    // retried forever and never surfaced. 'has been retired' is the ONE new
    // substring 161 introduces; this proves it actually reaches the
    // permanent bucket end to end, not just that the string exists in the
    // source.
    const storage = inMemoryStorage();
    await enqueuePendingReview(storage, pendingReview({ id: "q1", cardId: undefined, questionId: "question-retired" }));

    const { client } = multiRpcClient({
      submit_question_review: () => ({
        data: null,
        error: { message: "submit_question_review: question question-retired has been retired" },
      }),
    });
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.classification).toBe("permanent");
    expect(result.failures[0]?.questionId).toBe("question-retired");
    expect(await loadPendingReviews(storage)).toEqual([]); // dead-lettered, never retried
  });

  it("every OTHER submit_question_review guard string submit_review already has is still classified identically (shared isPermanentFailure, no question-specific branching needed)", async () => {
    const sharedMessages = [
      "submit_question_review: no authenticated user",
      "submit_question_review: rating must be 1..4",
      "submit_question_review: no card_states row for question q1 / user u1",
      "submit_question_review: reps must increase by exactly 1 (was 1, proposed 3)",
      "submit_question_review: stability must be > 0 (proposed -1)",
      "submit_question_review: due_at must be in the future (proposed 2020-01-01)",
      "submit_question_review: state is required",
      "submit_question_review: illegal transition new -> learning",
    ];
    for (const message of sharedMessages) {
      const storage = inMemoryStorage();
      await enqueuePendingReview(storage, pendingReview({ id: "q1", cardId: undefined, questionId: "q1" }));
      const { client } = multiRpcClient({
        submit_question_review: () => ({ data: null, error: { message } }),
      });
      const result = await replayPendingReviews(client, storage, "sess-1");
      expect(result.failures[0]?.classification, `expected permanent for: ${message}`).toBe("permanent");
    }
  });

  it("wasAlreadyApplied's lost-response recovery queries reviews by question_id for a question item, not card_id", async () => {
    const storage = inMemoryStorage();
    await enqueuePendingReview(
      storage,
      pendingReview({ id: "q1", cardId: undefined, questionId: "question-a", rating: 3, elapsedMs: 4000, confidence: null, answeredText: "ans" }),
    );

    let sawReplayAttempt = false;
    const { client } = multiRpcClient(
      {
        submit_question_review: () => {
          if (!sawReplayAttempt) {
            sawReplayAttempt = true;
            return { data: null, error: { message: "submit_question_review: reps must increase by exactly 1 (was 1, proposed 2)" } };
          }
          return { data: { id: "should-not-be-called-twice" }, error: null };
        },
      },
      (column, value) => (column === "question_id" && value === "question-a" ? { rating: 3, confidence: null, elapsed_ms: 4000, answered_text: "ans" } : null),
    );
    const result = await replayPendingReviews(client, storage, "sess-1");

    expect(result.succeeded).toEqual(["q1"]);
    expect(result.recoveredLostResponses).toEqual(["q1"]);
    expect(result.failures).toEqual([]);
  });
});
