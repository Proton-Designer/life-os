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

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    channel: channelMock,
    removeChannel: removeChannelMock,
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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does nothing when there is no signed-in user", () => {
    render(<RealtimeSyncProvider userId={null} />);
    expect(channelMock).not.toHaveBeenCalled();
  });

  it("subscribes to every synced table, filtered to the signed-in user's own rows", () => {
    render(<RealtimeSyncProvider userId="user-1" />);

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

    // Simulate 5 rapid-fire postgres_changes events (e.g. confirming a
    // workout session inserts several session_sets rows at once).
    for (const call of onCalls.slice(0, 5)) call.callback();
    expect(refreshMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on the initial subscribe — only on a RE-subscribe (reconnect)", async () => {
    render(<RealtimeSyncProvider userId="user-1" />);
    // The actual .subscribe() call is deferred by one microtask (dodges
    // React Strict Mode's dev-only double-invoke — see the component's
    // own comment), so subscribeCallback isn't set until this flushes.
    await vi.advanceTimersByTimeAsync(0);

    subscribeCallback!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).not.toHaveBeenCalled();

    // A drop and reconnect — the second SUBSCRIBED is the self-heal signal.
    subscribeCallback!("CLOSED");
    subscribeCallback!("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(400);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up the channel on unmount", () => {
    const { unmount } = render(<RealtimeSyncProvider userId="user-1" />);
    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(fakeChannel);
  });

  it("re-subscribes (a new channel) if the signed-in user changes", () => {
    const { rerender } = render(<RealtimeSyncProvider userId="user-1" />);
    expect(channelMock).toHaveBeenCalledTimes(1);

    const secondChannel = makeFakeChannel();
    channelMock.mockReturnValueOnce(secondChannel);
    rerender(<RealtimeSyncProvider userId="user-2" />);

    expect(removeChannelMock).toHaveBeenCalledWith(fakeChannel);
    expect(channelMock).toHaveBeenCalledTimes(2);
    expect(onCalls.some((c) => c.filter === "user_id=eq.user-2")).toBe(true);
  });
});
