import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendPushResult } from "../send-push";

const sendPushToUserMock = vi.fn<(...args: unknown[]) => Promise<SendPushResult>>();
vi.mock("../send-push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
}));

const { notifyBookReady } = await import("../book-ready-notification");

beforeEach(() => {
  sendPushToUserMock.mockReset();
});

/**
 * Claim-first-aware fake client: `claimedBooks` seeds which books already
 * hold a book_ready_notification_log row (a real prior send, or a
 * concurrent finalizingStage retry that already won) — the claim INSERT
 * simulates the unique-violation a real DB raises for those. `book` seeds
 * the one books row this function reads back. `deleteCalls` records every
 * release so tests can assert the claim was actually given back.
 */
function makeClient(
  opts: {
    claimedBooks?: Set<string>;
    book?: { title: string } | null;
  } = {}
) {
  const insertCalls: Record<string, unknown>[] = [];
  const deleteCalls: Record<string, unknown>[] = [];
  const claimed = new Set(opts.claimedBooks ?? []);

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const eqArgs: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqArgs[col] = val;
      return chain;
    });
    chain.delete = vi.fn(() => chain);
    chain.then = (resolve: (v: { error: null }) => void) => {
      if (table === "book_ready_notification_log") deleteCalls.push({ ...eqArgs });
      resolve({ error: null });
    };
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "book_ready_notification_log") {
        insertCalls.push(row);
        const bookId = row.book_id as string;
        if (claimed.has(bookId)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(bookId);
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ error: null });
    });
    if (table === "books") {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.book ?? null, error: null }));
    }
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, insertCalls, deleteCalls };
}

describe("notifyBookReady (#6)", () => {
  it("claims the book, sends a push naming its real title, and deep-links to that book's own page", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client, insertCalls, deleteCalls } = makeClient({ book: { title: "Deep Work" } });

    await notifyBookReady(client, "user-1", "book-1");

    expect(insertCalls[0]).toMatchObject({ user_id: "user-1", book_id: "book-1" });
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "Your book is ready", '"Deep Work" is ready to study', "/self-mastery/book-1");
    expect(deleteCalls).toHaveLength(0); // successful send -- claim stays, never released
  });

  it("skips entirely (no push attempt) when this book was already claimed -- the exactly-once guarantee", async () => {
    const { client } = makeClient({ claimedBooks: new Set(["book-1"]) });
    await notifyBookReady(client, "user-1", "book-1");
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("TWO OVERLAPPING calls for the same book (a genuine finalizingStage crash-retry): only one ever sends", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ book: { title: "Deep Work" } });

    await Promise.all([notifyBookReady(client, "user-1", "book-1"), notifyBookReady(client, "user-1", "book-1")]);

    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when delivery fully fails -- a genuine retry of the same book can still notify once it succeeds", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: false, delivered: 0, total: 0 });
    const { client, deleteCalls } = makeClient({ book: { title: "Deep Work" } });
    await notifyBookReady(client, "user-1", "book-1");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatchObject({ book_id: "book-1" });
  });

  it("releases the claim when the book can't be read (data inconsistency) rather than permanently burning the one-time slot", async () => {
    const { client, deleteCalls } = makeClient({ book: null });
    await notifyBookReady(client, "user-1", "book-1");
    expect(sendPushToUserMock).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(1);
  });

  it("a non-23505 error on the claim insert IS thrown, not swallowed", async () => {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.insert = vi.fn(() => Promise.resolve({ error: { code: "500" } }));
      return chain;
    });
    const client = { from } as unknown as SupabaseClient;
    await expect(notifyBookReady(client, "user-1", "book-1")).rejects.toBeTruthy();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });
});
