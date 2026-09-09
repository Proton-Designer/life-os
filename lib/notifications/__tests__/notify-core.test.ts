import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendPushResult } from "../send-push";

const sendPushToUserMock = vi.fn<(...args: unknown[]) => Promise<SendPushResult>>();
vi.mock("../send-push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
  hasAnyPushSubscription: vi.fn(async () => true),
}));

const { sendScheduledNotificationCore } = await import("../notify-core");

beforeEach(() => {
  sendPushToUserMock.mockReset();
});

function makeClient(opts: { alreadySent?: boolean; insertError?: { code?: string; message?: string } | null } = {}) {
  const insertCalls: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: opts.alreadySent ? { id: "log-1" } : null, error: null }));
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "mcp_notification_dispatch_log") insertCalls.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls };
}

const now = new Date("2026-09-08T20:00:00.000Z"); // 15:00 CDT -> local date 2026-09-08

describe("sendScheduledNotificationCore", () => {
  it("sends the push and records the dispatch-log row when delivery succeeds", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client, insertCalls } = makeClient();

    const result = await sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "Kill list", "Go review it");

    expect(result).toEqual({ delivered: 1, total: 1, alreadySent: false });
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "Kill list", "Go review it");
    expect(insertCalls[0]).toMatchObject({ user_id: "user-1", scheduled_action_id: "sched-1", sent_date: "2026-09-08" });
  });

  it("does NOT record a dispatch-log row when delivery fully fails (delivered:0) -- so a genuine retry can try again, not be blocked as 'already sent'", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 0, total: 1 });
    const { client, insertCalls } = makeClient();

    const result = await sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "Kill list", "Go review it");

    expect(result).toEqual({ delivered: 0, total: 1, alreadySent: false });
    expect(insertCalls).toHaveLength(0);
  });

  it("skips sending entirely (no push attempt) when this occurrence was already successfully delivered -- the idempotency check", async () => {
    const { client } = makeClient({ alreadySent: true });
    const result = await sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "Kill list", "Go review it");
    expect(result).toEqual({ delivered: 0, total: 0, alreadySent: true });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("a 23505 on the dispatch-log insert (a genuinely concurrent send winning the race) is swallowed, not thrown -- the push already happened either way", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ insertError: { code: "23505" } });
    const result = await sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "Kill list", "Go review it");
    expect(result.alreadySent).toBe(false); // this call's own send DID happen; the race is about the bookkeeping row, not re-attempted delivery
    expect(result.delivered).toBe(1);
  });

  it("a non-23505 dispatch-log insert error IS thrown", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ insertError: { code: "500", message: "db exploded" } });
    await expect(sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "Kill list", "Go review it")).rejects.toThrow(/db exploded/);
  });

  it("requires title and body as non-empty strings", async () => {
    const { client } = makeClient();
    await expect(sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "", "body")).rejects.toThrow(/patch\.title is required/i);
    await expect(sendScheduledNotificationCore(client, "user-1", "America/Chicago", now, "sched-1", "title", "")).rejects.toThrow(/patch\.body is required/i);
  });

  // AGENTS.md's rule: pin the exact UTC-rollover boundary, both sides.
  it("computes sent_date from the account's LOCAL date, not UTC -- 18:59 and 19:01 Chicago both land on the same local date across the UTC rollover", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });

    const { client: c1, insertCalls: calls1 } = makeClient();
    await sendScheduledNotificationCore(c1, "user-1", "America/Chicago", new Date("2026-09-08T23:59:00.000Z"), "sched-1", "t", "b"); // 18:59 CDT
    expect(calls1[0].sent_date).toBe("2026-09-08");

    const { client: c2, insertCalls: calls2 } = makeClient();
    await sendScheduledNotificationCore(c2, "user-1", "America/Chicago", new Date("2026-09-09T00:01:00.000Z"), "sched-1", "t", "b"); // 19:01 CDT, still the 8th locally
    expect(calls2[0].sent_date).toBe("2026-09-08");
  });
});
