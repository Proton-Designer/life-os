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
    nextState: { reps: 1, stability: 2, difficulty: 5, due_at: "2026-08-20T00:00:00.000Z", state: "learning" },
    ...overrides,
  };
}

function rpcClient(handler: (cardId: string) => { data: unknown; error: { message: string; code?: string } | null }) {
  const calledCardIds: string[] = [];
  const calledArgs: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (_fn: string, args: { p_card_id: string }) => {
    calledCardIds.push(args.p_card_id);
    calledArgs.push(args);
    return handler(args.p_card_id);
  });
  return { client: { rpc } as unknown as ReturnType<typeof createClient>, calledCardIds, calledArgs };
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
