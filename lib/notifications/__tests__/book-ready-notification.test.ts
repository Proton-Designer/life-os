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
 * PROPOSAL-STAGE COVERAGE: `book_ready_notification_log` (this file's
 * dedup table) has no migration number allocated yet -- these tests mock
 * the table shape the same way every other pre-migration-apply core file
 * in this codebase does (lib/goals's own tests are the precedent), so this
 * coverage is real regardless of when/whether the table lands.
 */
function makeClient(
  opts: {
    alreadyNotified?: boolean;
    book?: { title: string } | null;
    insertError?: { code?: string } | null;
  } = {}
) {
  const insertCalls: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "book_ready_notification_log") insertCalls.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    });
    if (table === "book_ready_notification_log") {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.alreadyNotified ? { id: "log-1" } : null, error: null }));
    }
    if (table === "books") {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.book ?? null, error: null }));
    }
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls };
}

describe("notifyBookReady (#6 proposal)", () => {
  it("sends a push naming the book's real title and deep-links to that book's own page", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client, insertCalls } = makeClient({ book: { title: "Deep Work" } });

    await notifyBookReady(client, "user-1", "book-1");

    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "Your book is ready", '"Deep Work" is ready to study', "/self-mastery/book-1");
    expect(insertCalls[0]).toMatchObject({ user_id: "user-1", book_id: "book-1" });
  });

  it("skips entirely (no push attempt) when this book was already notified -- the exactly-once guarantee", async () => {
    const { client } = makeClient({ alreadyNotified: true });
    await notifyBookReady(client, "user-1", "book-1");
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("does NOT record the log row when delivery fully fails -- a retry (e.g. a crash-retry of finalizingStage) can genuinely resend", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: false, delivered: 0, total: 0 });
    const { client, insertCalls } = makeClient({ book: { title: "Deep Work" } });
    await notifyBookReady(client, "user-1", "book-1");
    expect(insertCalls).toHaveLength(0);
  });

  it("skips sending when the book can't be read (data inconsistency) rather than pushing a titleless notification", async () => {
    const { client } = makeClient({ book: null });
    await notifyBookReady(client, "user-1", "book-1");
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("a 23505 on the log insert (a genuinely concurrent finalizingStage retry) is swallowed, not thrown", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ book: { title: "Deep Work" }, insertError: { code: "23505" } });
    await expect(notifyBookReady(client, "user-1", "book-1")).resolves.toBeUndefined();
  });

  it("a non-23505 log insert error IS thrown", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ book: { title: "Deep Work" }, insertError: { code: "500" } });
    await expect(notifyBookReady(client, "user-1", "book-1")).rejects.toBeTruthy();
  });
});
