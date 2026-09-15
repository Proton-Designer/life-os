import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendPushResult } from "../send-push";

const sendPushToUserMock = vi.fn<(...args: unknown[]) => Promise<SendPushResult>>();
vi.mock("../send-push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
}));

const countDueCardsMock = vi.fn<(...args: unknown[]) => Promise<number>>();
vi.mock("@/lib/self-mastery/session/build-session", () => ({
  countDueCards: (...args: unknown[]) => countDueCardsMock(...args),
}));

const { dispatchDueCardNotifications } = await import("../due-card-notification");

beforeEach(() => {
  sendPushToUserMock.mockReset();
  countDueCardsMock.mockReset();
});

const now = new Date("2026-09-14T20:00:00.000Z"); // 15:00 CDT -> local date 2026-09-14 in America/Chicago

/**
 * A per-table fake client. `notifiedUsers` seeds which users already have a
 * due_card_notification_log row for today (the idempotency check);
 * `dueCardRow` seeds one card_states/cards pair per user for
 * getOneDueCardPrompt. `insertCalls` records every due_card_notification_log
 * insert this test can assert against.
 */
function makeClient(
  opts: {
    subs?: { user_id: string }[];
    profiles?: { user_id: string; timezone: string | null }[];
    notifiedUsers?: Set<string>;
    dueCardByUser?: Record<string, { cardId: string; prompt: string } | undefined>;
    insertError?: { code?: string } | null;
  } = {}
) {
  const insertCalls: Record<string, unknown>[] = [];
  const notified = new Set(opts.notifiedUsers ?? []);

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const eqArgs: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqArgs[col] = val;
      return chain;
    });
    chain.neq = vi.fn(() => chain);
    chain.lte = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "due_card_notification_log") insertCalls.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    });

    if (table === "push_subscriptions") {
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.subs ?? [], error: null });
    }
    if (table === "profiles") {
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.profiles ?? [], error: null });
    }
    if (table === "due_card_notification_log") {
      chain.maybeSingle = vi.fn(async () => ({
        data: notified.has(eqArgs.user_id as string) ? { id: "log-1" } : null,
        error: null,
      }));
    }
    if (table === "card_states") {
      chain.maybeSingle = vi.fn(async () => {
        const row = opts.dueCardByUser?.[eqArgs.user_id as string];
        return { data: row ? { card_id: row.cardId } : null, error: null };
      });
    }
    if (table === "cards") {
      chain.maybeSingle = vi.fn(async () => {
        const row = Object.values(opts.dueCardByUser ?? {}).find((r) => r?.cardId === eqArgs.id);
        return { data: row ? { prompt: row.prompt } : null, error: null };
      });
    }
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, insertCalls };
}

describe("dispatchDueCardNotifications (#10)", () => {
  it("returns zero-checked when nobody has a push subscription at all", async () => {
    const { client } = makeClient({ subs: [] });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result).toEqual({ usersChecked: 0, dispatched: 0 });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("skips a user who was already notified today (the DB-uniqueness idempotency check)", async () => {
    const { client, insertCalls } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      notifiedUsers: new Set(["user-1"]),
    });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result).toEqual({ usersChecked: 1, dispatched: 0 });
    expect(countDueCardsMock).not.toHaveBeenCalled();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("skips a user with zero due cards -- no notification for an empty deck", async () => {
    countDueCardsMock.mockResolvedValue(0);
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
    });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result).toEqual({ usersChecked: 1, dispatched: 0 });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("sends a push naming the actual due card's (truncated) prompt, and records the dispatch-log row", async () => {
    countDueCardsMock.mockResolvedValue(3);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client, insertCalls } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "What is the capital of France?" } },
    });

    const result = await dispatchDueCardNotifications(client, now);

    expect(result).toEqual({ usersChecked: 1, dispatched: 1 });
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "3 cards are due", "What is the capital of France?", "/");
    // "Daily" is the USER's local date (America/Chicago, UTC-5 in September):
    // 2026-09-14T20:00:00Z is 15:00 local, still the 14th.
    expect(insertCalls[0]).toMatchObject({ user_id: "user-1", sent_date: "2026-09-14" });
  });

  it("singular copy for exactly one due card", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "Recall the Pythagorean theorem" } },
    });
    await dispatchDueCardNotifications(client, now);
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "1 card is due", "Recall the Pythagorean theorem", "/");
  });

  it("truncates a long prompt and collapses internal whitespace/newlines", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const longPrompt = "Line one\nLine two with   extra spaces\n" + "x".repeat(100);
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: longPrompt } },
    });
    await dispatchDueCardNotifications(client, now);
    const body = sendPushToUserMock.mock.calls[0][3] as string;
    expect(body.length).toBeLessThanOrEqual(80);
    expect(body).not.toContain("\n");
    expect(body.endsWith("…")).toBe(true);
  });

  it("does NOT record the dispatch-log row when delivery fully fails -- so the next 15-minute tick can genuinely retry today", async () => {
    countDueCardsMock.mockResolvedValue(2);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 0, total: 1 });
    const { client, insertCalls } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
    });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result.dispatched).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("skips a user whose due card cannot actually be read (data inconsistency) rather than sending a vague push", async () => {
    countDueCardsMock.mockResolvedValue(1);
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      dueCardByUser: {},
    });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result.dispatched).toBe(0);
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("defaults a user with no profile row to UTC rather than throwing", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
    });
    await expect(dispatchDueCardNotifications(client, now)).resolves.toEqual({ usersChecked: 1, dispatched: 1 });
  });

  it("processes each distinct user independently -- one skipped, one dispatched", async () => {
    countDueCardsMock.mockImplementation(async (...args: unknown[]) => ((args[1] as string) === "user-1" ? 0 : 2));
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }, { user_id: "user-2" }],
      profiles: [
        { user_id: "user-1", timezone: "UTC" },
        { user_id: "user-2", timezone: "UTC" },
      ],
      dueCardByUser: { "user-2": { cardId: "card-2", prompt: "Second user's card" } },
    });
    const result = await dispatchDueCardNotifications(client, now);
    expect(result).toEqual({ usersChecked: 2, dispatched: 1 });
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-2", "2 cards are due", "Second user's card", "/");
  });

  it("a 23505 on the dispatch-log insert (a genuinely concurrent tick) is swallowed, not thrown", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      insertError: { code: "23505" },
    });
    await expect(dispatchDueCardNotifications(client, now)).resolves.toEqual({ usersChecked: 1, dispatched: 1 });
  });
});
