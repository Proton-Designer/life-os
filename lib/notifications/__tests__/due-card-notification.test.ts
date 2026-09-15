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

// America/Chicago is UTC-5 in September (no DST ambiguity to worry about
// for these instants). 13:00Z == 08:00 local.
const AT_0800_LOCAL = new Date("2026-09-14T13:00:00.000Z");
const AT_0759_LOCAL = new Date("2026-09-14T12:59:00.000Z");
const AT_2359_LOCAL = new Date("2026-09-14T04:59:00.000Z"); // 23:59 on the 13th local
const AT_0900_LOCAL = new Date("2026-09-14T14:00:00.000Z"); // window just closed (>= threshold + 1h)

/**
 * A per-table fake client claim-first-aware: `claimedUsers` seeds which
 * users already hold a due_card_notification_log row for today (a prior
 * successful send, or a concurrent tick that already won the race) — the
 * claim INSERT itself simulates the unique-violation a real DB would raise
 * for those users. `dueCardByUser` seeds one card_states/cards pair per
 * user for getOneDueCardPrompt. `insertCalls`/`deleteCalls` record every
 * due_card_notification_log write this test can assert against.
 */
function makeClient(
  opts: {
    subs?: { user_id: string }[];
    profiles?: { user_id: string; timezone: string | null; checkin_window_start?: string | null }[];
    claimedUsers?: Set<string>;
    dueCardByUser?: Record<string, { cardId: string; prompt: string } | undefined>;
  } = {}
) {
  const insertCalls: Record<string, unknown>[] = [];
  const deleteCalls: Record<string, unknown>[] = [];
  const claimed = new Set(opts.claimedUsers ?? []);

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
    chain.delete = vi.fn(() => {
      // .delete().eq(...).eq(...) -- terminal await resolves via .then below,
      // but we record the call here (eqArgs accumulates across both .eq calls).
      return chain;
    });
    chain.then = (resolve: (v: { error: null }) => void) => {
      if (table === "due_card_notification_log") {
        deleteCalls.push({ ...eqArgs });
      }
      resolve({ error: null });
    };
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "due_card_notification_log") {
        insertCalls.push(row);
        const userId = row.user_id as string;
        if (claimed.has(userId)) {
          return Promise.resolve({ error: { code: "23505" } });
        }
        claimed.add(userId); // this call itself now "holds" the claim
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ error: null });
    });

    if (table === "push_subscriptions") {
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.subs ?? [], error: null });
    }
    if (table === "profiles") {
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: opts.profiles ?? [], error: null });
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

  return { client: { from } as unknown as SupabaseClient, insertCalls, deleteCalls };
}

describe("dispatchDueCardNotifications (#10)", () => {
  it("returns zero-checked when nobody has a push subscription at all", async () => {
    const { client } = makeClient({ subs: [] });
    const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
    expect(result).toEqual({ usersChecked: 0, dispatched: 0 });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  describe("the send window", () => {
    it("does not send at 07:59 local -- before the morning threshold", async () => {
      countDueCardsMock.mockResolvedValue(2);
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0759_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
    });

    it("sends at 08:00 local -- exactly the morning threshold", async () => {
      countDueCardsMock.mockResolvedValue(2);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(1);
    });

    it("does not send at 23:59 local -- the window is a bounded 1h slot, not open-ended for the rest of the day", async () => {
      countDueCardsMock.mockResolvedValue(2);
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_2359_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
    });

    it("does not send once the window has closed (threshold + 1h)", async () => {
      countDueCardsMock.mockResolvedValue(2);
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0900_LOCAL);
      expect(result.dispatched).toBe(0);
    });

    it("a user in a DIFFERENT timezone at the SAME UTC instant gets a different answer", async () => {
      countDueCardsMock.mockResolvedValue(1);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      // AT_0800_LOCAL (13:00Z) is 08:00 in America/Chicago (send) but 22:00
      // in Asia/Tokyo (UTC+9 -- outside that user's own morning window).
      const { client } = makeClient({
        subs: [{ user_id: "chicago-user" }, { user_id: "tokyo-user" }],
        profiles: [
          { user_id: "chicago-user", timezone: "America/Chicago" },
          { user_id: "tokyo-user", timezone: "Asia/Tokyo" },
        ],
        dueCardByUser: {
          "chicago-user": { cardId: "c1", prompt: "x" },
          "tokyo-user": { cardId: "c2", prompt: "y" },
        },
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(1);
      expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
      expect(sendPushToUserMock).toHaveBeenCalledWith(client, "chicago-user", expect.any(String), expect.any(String), "/");
    });

    it("uses profiles.checkin_window_start as the threshold when set, instead of the 08:00 default", async () => {
      countDueCardsMock.mockResolvedValue(1);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago", checkin_window_start: "06:00:00" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      // 06:00 local == 11:00Z. AT_0759_LOCAL (12:59Z == 07:59 local) is
      // within [06:00, 07:00)? No -- past it. Use an instant at 06:00 local
      // (11:00Z) to prove the CUSTOM threshold, not the default, gates this.
      const at0600Local = new Date("2026-09-14T11:00:00.000Z");
      const result = await dispatchDueCardNotifications(client, at0600Local);
      expect(result.dispatched).toBe(1);
    });
  });

  describe("claim-first locking", () => {
    it("skips a user who already holds today's claim (a prior successful send)", async () => {
      countDueCardsMock.mockResolvedValue(2);
      const { client, insertCalls } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        claimedUsers: new Set(["user-1"]),
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
      // The claim attempt still happens (that IS the check) but wins nothing.
      expect(insertCalls).toHaveLength(1);
    });

    it("TWO OVERLAPPING invocations for the same user: only one ever sends, never both", async () => {
      countDueCardsMock.mockResolvedValue(2);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      // A single shared client simulates two overlapping ticks racing on the
      // SAME underlying claim state -- the second call's insert() sees the
      // first call's already-claimed row via the shared `claimed` set.
      const { client } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });

      const [first, second] = await Promise.all([
        dispatchDueCardNotifications(client, AT_0800_LOCAL),
        dispatchDueCardNotifications(client, AT_0800_LOCAL),
      ]);

      const totalDispatched = first.dispatched + second.dispatched;
      expect(totalDispatched).toBe(1);
      expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    });

    it("releases the claim (deletes the row) when delivery fully fails, so a later tick can retry today", async () => {
      countDueCardsMock.mockResolvedValue(2);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 0, total: 1 });
      const { client, insertCalls, deleteCalls } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(insertCalls).toHaveLength(1);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]).toMatchObject({ user_id: "user-1", sent_date: "2026-09-14" });
    });

    it("releases the claim when the due card cannot actually be read (data inconsistency)", async () => {
      countDueCardsMock.mockResolvedValue(1);
      const { client, insertCalls, deleteCalls } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: {},
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
      expect(deleteCalls).toHaveLength(1);
    });

    it("does NOT delete/release the claim after a successful send -- it stays claimed for the rest of the day", async () => {
      countDueCardsMock.mockResolvedValue(1);
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client, deleteCalls } = makeClient({
        subs: [{ user_id: "user-1" }],
        profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
      });
      const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
      expect(result.dispatched).toBe(1);
      expect(deleteCalls).toHaveLength(0);
    });
  });

  it("skips a user with zero due cards -- no notification, and no claim attempted, for an empty deck", async () => {
    countDueCardsMock.mockResolvedValue(0);
    const { client, insertCalls } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
    });
    const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
    expect(result).toEqual({ usersChecked: 1, dispatched: 0 });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("sends a push naming the actual due card's (truncated) prompt", async () => {
    countDueCardsMock.mockResolvedValue(3);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "What is the capital of France?" } },
    });

    const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);

    expect(result).toEqual({ usersChecked: 1, dispatched: 1 });
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "3 cards are due", "What is the capital of France?", "/");
  });

  it("singular copy for exactly one due card", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "Recall the Pythagorean theorem" } },
    });
    await dispatchDueCardNotifications(client, AT_0800_LOCAL);
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-1", "1 card is due", "Recall the Pythagorean theorem", "/");
  });

  it("truncates a long prompt and collapses internal whitespace/newlines", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const longPrompt = "Line one\nLine two with   extra spaces\n" + "x".repeat(100);
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: longPrompt } },
    });
    await dispatchDueCardNotifications(client, AT_0800_LOCAL);
    const body = sendPushToUserMock.mock.calls[0][3] as string;
    expect(body.length).toBeLessThanOrEqual(80);
    expect(body).not.toContain("\n");
    expect(body.endsWith("…")).toBe(true);
  });

  it("defaults a user with no profile row to UTC / the 08:00 default rather than throwing", async () => {
    countDueCardsMock.mockResolvedValue(1);
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }],
      profiles: [],
      dueCardByUser: { "user-1": { cardId: "card-1", prompt: "x" } },
    });
    // 13:00Z is 08:00 in UTC-as-fallback-timezone too (UTC == UTC).
    const atUtcDefault = new Date("2026-09-14T08:00:00.000Z");
    await expect(dispatchDueCardNotifications(client, atUtcDefault)).resolves.toEqual({ usersChecked: 1, dispatched: 1 });
  });

  it("processes each distinct user independently -- one skipped (no due cards), one dispatched", async () => {
    countDueCardsMock.mockImplementation(async (...args: unknown[]) => ((args[1] as string) === "user-1" ? 0 : 2));
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({
      subs: [{ user_id: "user-1" }, { user_id: "user-2" }],
      profiles: [
        { user_id: "user-1", timezone: "America/Chicago" },
        { user_id: "user-2", timezone: "America/Chicago" },
      ],
      dueCardByUser: { "user-2": { cardId: "card-2", prompt: "Second user's card" } },
    });
    const result = await dispatchDueCardNotifications(client, AT_0800_LOCAL);
    expect(result).toEqual({ usersChecked: 2, dispatched: 1 });
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUserMock).toHaveBeenCalledWith(client, "user-2", "2 cards are due", "Second user's card", "/");
  });
});
