import { render, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// One shared fake channel per test, capturing every table this provider
// subscribes to plus a way to simulate the connection status callback the
// real supabase-js realtime client invokes.
let onCalls: { table: string; filter: string; callback: () => void }[] = [];
let subscribeCallback: ((status: string) => void) | null = null;
const removeChannelMock = vi.fn();

function makeFakeChannel() {
  const channel = {
    on: vi.fn((_event: string, config: { table: string; filter: string }, callback: () => void) => {
      onCalls.push({ table: config.table, filter: config.filter, callback });
      return channel;
    }),
    subscribe: vi.fn((cb: (status: string) => void) => {
      subscribeCallback = cb;
      return channel;
    }),
  };
  return channel;
}

let fakeChannel: ReturnType<typeof makeFakeChannel>;
const channelMock = vi.fn(() => fakeChannel);

const getSessionMock = vi.fn(async () => ({ data: { session: { access_token: "real-jwt" } } }));
const setAuthMock = vi.fn(async () => {});

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    channel: channelMock,
    removeChannel: removeChannelMock,
    auth: { getSession: getSessionMock },
    realtime: { setAuth: setAuthMock },
  })),
}));

import { RealtimeSyncProvider } from "../realtime-sync-provider";

describe("RealtimeSyncProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onCalls = [];
    subscribeCallback = null;
    fakeChannel = makeFakeChannel();
    refreshMock.mockReset();
    removeChannelMock.mockReset();
    channelMock.mockClear();
    getSessionMock.mockClear();
    getSessionMock.mockImplementation(async () => ({ data: { session: { access_token: "real-jwt" } } }));
    setAuthMock.mockClear();
  });

  // Every real subscribe now happens after two awaited steps
  // (getSession() then setAuth()) — flush both before asserting on the
  // channel, matching the real join()'s shape.
  async function flushJoin() {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
  }

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does nothing when there is no signed-in user", () => {
    render(<RealtimeSyncProvider userId={null} />);
    expect(channelMock).not.toHaveBeenCalled();
  });

  it("subscribes to every synced table, filtered to the signed-in user's own rows", async () => {
    render(<RealtimeSyncProvider userId="user-1" />);
    await flushJoin();

    const tables = onCalls.map((c) => c.table);
    expect(tables).toEqual(
      expect.arrayContaining([
        "prayers",
        "sunnah_logs",
        "tasks",
        "kill_list_items",
        "deen_habit_logs",
        "habit_logs",
        "body_metrics",
        "workout_sessions",
        "session_sets",
      ])
    );
    // Every subscription is filtered server-side to this user's own
    // rows — never an unfiltered "* " subscription relying on RLS alone
    // to narrow it after the fact.
    for (const call of onCalls) {
      expect(call.filter).toBe("user_id=eq.user-1");
    }
  });

  it("debounces a burst of change events into a single router.refresh()", async () => {
    render(<RealtimeSyncProvider userId="user-1" />);
    await flushJoin();

    // Simulate 5 rapid-fire postgres_changes events (e.g. confirming a
    // workout session inserts several session_sets rows at once).
    for (const call of onCalls.slice(0, 5)) call.callback();
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  // ROOT CAUSE (2026-08-26): a channel's postgres_changes RLS scoping is
  // fixed at JOIN time, and a session restored from cookies is async — a
  // subscribe() that races ahead of that restore joins under the anon
  // role forever, even though the socket looks healthy afterward. The fix
  // is to await the session and set realtime auth ourselves BEFORE ever
  // building the channel, deterministically — never subscribe first and
  // hope the SDK's own internal auth listener has already caught up.
  it("waits for the session and sets realtime auth before ever subscribing — not after", async () => {
    let resolveSession!: (v: { data: { session: { access_token: string } } }) => void;
    getSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        })
    );

    render(<RealtimeSyncProvider userId="user-1" />);
    await vi.advanceTimersByTimeAsync(0);
    // getSession() hasn't resolved yet — the channel must not exist, and
    // subscribe() must not have been called. This is exactly the race
    // that used to silently break sync: subscribing before the session
    // resolves joins under the anon role forever.
    expect(channelMock).not.toHaveBeenCalled();
    expect(setAuthMock).not.toHaveBeenCalled();

    resolveSession({ data: { session: { access_token: "real-jwt" } } });
    await flushJoin();

    // setAuth must be called (and awaited) before the channel is ever built.
    expect(setAuthMock).toHaveBeenCalledWith("real-jwt");
    expect(channelMock).toHaveBeenCalledTimes(1);
    const setAuthOrder = setAuthMock.mock.invocationCallOrder[0];
    const channelOrder = channelMock.mock.invocationCallOrder[0];
    expect(setAuthOrder).toBeLessThan(channelOrder);
  });

  it("does not refresh on the initial subscribe — only on a RE-subscribe (reconnect)", async () => {
    render(<RealtimeSyncProvider userId="user-1" />);
    await flushJoin();

    subscribeCallback!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).not.toHaveBeenCalled();

    // A drop and reconnect — the second SUBSCRIBED is the self-heal signal.
    subscribeCallback!("CLOSED");
    subscribeCallback!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up the channel on unmount", async () => {
    const { unmount } = render(<RealtimeSyncProvider userId="user-1" />);
    await flushJoin();
    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(fakeChannel);
  });

  it("a phantom Strict-Mode first mount never subscribes at all — its cleanup cancels the join before the awaited session resolves", async () => {
    const { unmount } = render(<RealtimeSyncProvider userId="user-1" />);
    // Unmount immediately, before getSession() has resolved — simulates
    // Strict Mode's dev-only double-invoke's phantom first mount.
    unmount();
    await flushJoin();
    expect(channelMock).not.toHaveBeenCalled();
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it("re-subscribes (a new channel) if the signed-in user changes", async () => {
    const { rerender } = render(<RealtimeSyncProvider userId="user-1" />);
    await flushJoin();
    expect(channelMock).toHaveBeenCalledTimes(1);

    const secondChannel = makeFakeChannel();
    channelMock.mockReturnValueOnce(secondChannel);
    rerender(<RealtimeSyncProvider userId="user-2" />);
    await flushJoin();

    expect(removeChannelMock).toHaveBeenCalledWith(fakeChannel);
    expect(channelMock).toHaveBeenCalledTimes(2);
    expect(onCalls.some((c) => c.filter === "user_id=eq.user-2")).toBe(true);
  });
});
