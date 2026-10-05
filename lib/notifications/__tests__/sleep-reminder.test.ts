import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendPushResult } from "../send-push";

const sendPushToUserMock = vi.fn<(...args: unknown[]) => Promise<SendPushResult>>();
vi.mock("../send-push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
}));

const { dispatchSleepReminders, reminderWindowStartLocal } = await import("../sleep-reminder");
const { DEFAULT_WIND_DOWN } = await import("@/lib/home/rhythm-state");

beforeEach(() => {
  sendPushToUserMock.mockReset();
});

// America/Chicago is UTC-5 in September. With no plan the window is [21:00, 23:00) local -- 21:00 is Home's own default wind-down.
const AT_2059_LOCAL = new Date("2026-09-15T01:59:00.000Z"); // 20:59 CDT -- before the window
const AT_2100_LOCAL = new Date("2026-09-15T02:00:00.000Z"); // 21:00 CDT -- window opens
const AT_2259_LOCAL = new Date("2026-09-15T03:59:00.000Z"); // 22:59 -- still inside
const AT_2300_LOCAL = new Date("2026-09-15T04:00:00.000Z"); // 23:00 -- window just closed
const AT_2130_LOCAL = new Date("2026-09-15T02:30:00.000Z"); // 21:30 CDT on the 14th

function makeClient(
  opts: {
    optedInProfiles?: { user_id: string; timezone: string | null }[];
    claimedUsers?: Set<string>;
    settings?: { user_id: string; wake_time: string | null; sleep_need_minutes: number | null; wind_down_minutes: number | null }[];
  } = {}
) {
  const insertCalls: Record<string, unknown>[] = [];
  const deleteCalls: Record<string, unknown>[] = [];
  const profilesEqCalls: [string, unknown][] = [];
  const profilesContainsCalls: [string, unknown][] = [];
  const claimed = new Set(opts.claimedUsers ?? []);

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const eqArgs: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqArgs[col] = val;
      if (table === "profiles") profilesEqCalls.push([col, val]);
      return chain;
    });
    chain.contains = vi.fn((col: string, val: unknown) => {
      if (table === "profiles") profilesContainsCalls.push([col, val]);
      return chain;
    });
    chain.in = vi.fn(() => chain);
    chain.delete = vi.fn(() => chain);
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      if (table === "sleep_reminder_log") {
        deleteCalls.push({ ...eqArgs });
        return resolve({ data: null, error: null });
      }
      if (table === "profiles") return resolve({ data: opts.optedInProfiles ?? [], error: null });
      if (table === "user_settings") return resolve({ data: opts.settings ?? [], error: null });
      resolve({ data: null, error: null });
    };
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === "sleep_reminder_log") {
        insertCalls.push(row);
        const userId = row.user_id as string;
        if (claimed.has(userId)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(userId);
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ error: null });
    });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, insertCalls, deleteCalls, profilesEqCalls, profilesContainsCalls };
}

describe("dispatchSleepReminders (P2-05)", () => {
  it("returns zero-checked when nobody has opted in", async () => {
    const { client } = makeClient({ optedInProfiles: [] });
    const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
    expect(result).toEqual({ usersChecked: 0, dispatched: 0 });
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("filters on sleep_reminder_enabled=true IN THE QUERY, not as a post-fetch filter", async () => {
    const { client, profilesEqCalls } = makeClient({ optedInProfiles: [] });
    await dispatchSleepReminders(client, AT_2130_LOCAL);
    expect(profilesEqCalls).toContainEqual(["sleep_reminder_enabled", true]);
  });

  // RS-01: the reminder belongs to the opt-in Sleep plan feature (OFF by default for everyone).
  it("only considers accounts that turned the Sleep plan feature on, IN THE QUERY", async () => {
    const { client, profilesContainsCalls } = makeClient({ optedInProfiles: [] });
    await dispatchSleepReminders(client, AT_2130_LOCAL);
    expect(profilesContainsCalls).toContainEqual(["enabled_features", ["sleep_plan"]]);
  });

  describe("the send window", () => {
    it("does not send at 20:59 local -- before the window opens", async () => {
      const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2059_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
    });

    it("sends at exactly 21:00 local -- the window opening (the same moment Home's Close-the-day card flips)", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2100_LOCAL);
      expect(result.dispatched).toBe(1);
    });

    it("still sends near the end of the window (22:59 local)", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2259_LOCAL);
      expect(result.dispatched).toBe(1);
    });

    it("does not send once the window has closed (23:00 local)", async () => {
      const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2300_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
    });

    it("a user in a different timezone at the SAME UTC instant gets a different answer", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      // AT_2130_LOCAL (02:30Z) is 21:30 in America/Chicago (send) but 11:30
      // the next morning in Asia/Tokyo (UTC+9 -- outside that user's window).
      const { client } = makeClient({
        optedInProfiles: [
          { user_id: "chicago-user", timezone: "America/Chicago" },
          { user_id: "tokyo-user", timezone: "Asia/Tokyo" },
        ],
      });
      const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
      expect(result.dispatched).toBe(1);
      expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
      expect(sendPushToUserMock).toHaveBeenCalledWith(client, "chicago-user", "Wind down", expect.any(String), "/close");
    });
  });

  describe("claim-first locking", () => {
    it("skips a user who already holds today's claim", async () => {
      const { client, insertCalls } = makeClient({
        optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }],
        claimedUsers: new Set(["user-1"]),
      });
      const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(sendPushToUserMock).not.toHaveBeenCalled();
      expect(insertCalls).toHaveLength(1);
    });

    it("TWO OVERLAPPING invocations for the same user: only one ever sends", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const [first, second] = await Promise.all([dispatchSleepReminders(client, AT_2130_LOCAL), dispatchSleepReminders(client, AT_2130_LOCAL)]);
      expect(first.dispatched + second.dispatched).toBe(1);
      expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    });

    it("THE REGRESSION GUARD: releases the claim when delivery fully fails, so a later tick can retry", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 0, total: 1 });
      const { client, insertCalls, deleteCalls } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(insertCalls).toHaveLength(1);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]).toMatchObject({ user_id: "user-1", sent_date: "2026-09-14" });
    });

    it("releases the claim when the user has no push subscription at all", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: false, delivered: 0, total: 0 });
      const { client, deleteCalls } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
      expect(result.dispatched).toBe(0);
      expect(deleteCalls).toHaveLength(1);
    });

    it("does NOT release the claim after a successful send", async () => {
      sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
      const { client, deleteCalls } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: "America/Chicago" }] });
      const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
      expect(result.dispatched).toBe(1);
      expect(deleteCalls).toHaveLength(0);
    });
  });

  it("processes each distinct user independently", async () => {
    sendPushToUserMock.mockImplementation(async (..._args: unknown[]) =>
      (_args[1] as string) === "user-1" ? { hadSubscriptions: false, delivered: 0, total: 0 } : { hadSubscriptions: true, delivered: 1, total: 1 }
    );
    const { client } = makeClient({
      optedInProfiles: [
        { user_id: "user-1", timezone: "America/Chicago" },
        { user_id: "user-2", timezone: "America/Chicago" },
      ],
    });
    const result = await dispatchSleepReminders(client, AT_2130_LOCAL);
    expect(result).toEqual({ usersChecked: 2, dispatched: 1 });
  });

  it("a profile with no timezone defaults to UTC rather than throwing", async () => {
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient({ optedInProfiles: [{ user_id: "user-1", timezone: null }] });
    const atUtc2130 = new Date("2026-09-15T21:30:00.000Z");
    await expect(dispatchSleepReminders(client, atUtc2130)).resolves.toEqual({ usersChecked: 1, dispatched: 1 });
  });
});

// IA-P4a: the window follows the user's own wind-down plan.
describe("dispatchSleepReminders — wind-down plan window (IA-P4a)", () => {
  const plan = (id: string) => ({ user_id: id, wake_time: "07:00", sleep_need_minutes: 480, wind_down_minutes: 45 }); // wind-down 22:15
  const AT_2214 = new Date("2026-09-15T03:14:00.000Z"); // 22:14 CDT
  const AT_2215 = new Date("2026-09-15T03:15:00.000Z"); // 22:15 CDT
  const AT_2131 = AT_2130_LOCAL;

  it("with a plan, nothing is sent before the user's wind-down start, even past the old 21:30", async () => {
    const { client } = makeClient({ optedInProfiles: [{ user_id: "u1", timezone: "America/Chicago" }], settings: [plan("u1")] });
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    expect((await dispatchSleepReminders(client, AT_2131)).dispatched).toBe(0);
    expect((await dispatchSleepReminders(client, AT_2214)).dispatched).toBe(0);
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("with a plan, it fires from the wind-down start and opens /close", async () => {
    const { client } = makeClient({ optedInProfiles: [{ user_id: "u1", timezone: "America/Chicago" }], settings: [plan("u1")] });
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    expect((await dispatchSleepReminders(client, AT_2215)).dispatched).toBe(1);
    expect(sendPushToUserMock.mock.calls[0]![4]).toBe("/close");
  });

  it("without a plan the window opens at Home's default 21:00 (not a different 21:30)", async () => {
    const { client } = makeClient({ optedInProfiles: [{ user_id: "u1", timezone: "America/Chicago" }], settings: [] });
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    expect((await dispatchSleepReminders(client, AT_2059_LOCAL)).dispatched).toBe(0);
    expect((await dispatchSleepReminders(client, AT_2100_LOCAL)).dispatched).toBe(1);
  });

  it("a wind-down at/after 23:45 still gets a >=30 min window: the reminder opens by 23:30", async () => {
    const veryLate = { user_id: "u1", wake_time: "09:30", sleep_need_minutes: 540, wind_down_minutes: 45 }; // bed 00:30, wind-down 23:45
    const { client } = makeClient({ optedInProfiles: [{ user_id: "u1", timezone: "America/Chicago" }], settings: [veryLate] });
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    expect((await dispatchSleepReminders(client, new Date("2026-09-15T04:29:00.000Z"))).dispatched).toBe(0); // 23:29
    expect((await dispatchSleepReminders(client, new Date("2026-09-15T04:30:00.000Z"))).dispatched).toBe(1); // 23:30
  });

  it("a late wind-down (23:15) never leaks past local midnight", async () => {
    const late = { user_id: "u1", wake_time: "09:00", sleep_need_minutes: 540, wind_down_minutes: 45 }; // wind-down 23:15
    const { client } = makeClient({ optedInProfiles: [{ user_id: "u1", timezone: "America/Chicago" }], settings: [late] });
    sendPushToUserMock.mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    expect((await dispatchSleepReminders(client, new Date("2026-09-15T04:14:00.000Z"))).dispatched).toBe(0); // 23:14
    expect((await dispatchSleepReminders(client, new Date("2026-09-15T04:15:00.000Z"))).dispatched).toBe(1); // 23:15
  });
});

describe("one shared default with Home's Close-the-day card", () => {
  it("with no plan the reminder window starts at exactly the wind-down default Home flips on", () => {
    expect(reminderWindowStartLocal(undefined)).toBe(DEFAULT_WIND_DOWN);
    expect(reminderWindowStartLocal({ wake_time: null, sleep_need_minutes: null, wind_down_minutes: null })).toBe(DEFAULT_WIND_DOWN);
  });
  it("with a plan, both follow the plan's wind-down start", () => {
    expect(reminderWindowStartLocal({ wake_time: "07:00", sleep_need_minutes: 480, wind_down_minutes: 45 })).toBe("22:15");
  });
});

