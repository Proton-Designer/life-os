import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AllocationQueueResult } from "../get-allocation-queue";

/**
 * `getPendingAllocationQueue` itself (its scheduling/prefill correctness)
 * is already pinned by lib/checkins/__tests__/get-allocation-queue.test.ts
 * against a fake `AllocationQueueDataSource` — these tests mock the
 * function's RETURN VALUE directly instead, so they exercise
 * `saveAllocationCheckinCore`'s own logic (which tier it picks, how it
 * shapes the RPC call, its validation) independent of the real scheduling
 * algorithm underneath it.
 *
 * The mock factory wraps the outer `getPendingAllocationQueueMock` in a
 * nested arrow function rather than referencing it directly as an export —
 * `vi.mock` factories are hoisted above `const` declarations, so a direct
 * reference would throw "Cannot access before initialization"; a closure
 * that only reads the const when actually CALLED (well after module init
 * finishes) sidesteps that entirely.
 */
const getPendingAllocationQueueMock = vi.fn<(userId: string, now: Date, dataSource?: unknown) => Promise<AllocationQueueResult>>();
vi.mock("../get-allocation-queue", () => ({
  getPendingAllocationQueue: (userId: string, now: Date, dataSource?: unknown) => getPendingAllocationQueueMock(userId, now, dataSource),
  supabaseDataSource: vi.fn((supabase: unknown) => ({ __marker: "supabaseDataSource", supabase })),
}));

const { saveAllocationCheckinCore } = await import("../actions-core");

beforeEach(() => {
  getPendingAllocationQueueMock.mockReset();
});

function makeClient(opts: { rpcData?: string; rpcError?: unknown } = {}) {
  const rpcCalls: [string, Record<string, unknown>][] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    return { data: opts.rpcData ?? "checkin-new", error: opts.rpcError ?? null };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpcCalls };
}

const EMPTY_QUEUE: AllocationQueueResult = { items: [], unknownCount: 0, timezone: "America/Chicago", mostRecentUnanswered: null };

describe("saveAllocationCheckinCore — window selection (mirrors AllocationCheckinGate's own 3-tier fallback)", () => {
  it("prefers queue[0] (a window that fired within its answer window) when present", async () => {
    getPendingAllocationQueueMock.mockResolvedValue({
      ...EMPTY_QUEUE,
      items: [{ windowStartIso: "2026-09-08T13:00:00.000Z", windowEndIso: "2026-09-08T15:00:00.000Z", prefill: {} }],
      mostRecentUnanswered: { windowStartIso: "2026-09-07T13:00:00.000Z", windowEndIso: "2026-09-07T15:00:00.000Z", prefill: {} },
    });
    const { client, rpcCalls } = makeClient();

    const result = await saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 30 });

    expect(rpcCalls[0][1]).toMatchObject({ p_window_start: "2026-09-08T13:00:00.000Z", p_window_end: "2026-09-08T15:00:00.000Z" });
    expect(result.wasScheduledWindow).toBe(true);
  });

  it("falls back to mostRecentUnanswered when the answer-window queue is empty", async () => {
    getPendingAllocationQueueMock.mockResolvedValue({
      ...EMPTY_QUEUE,
      mostRecentUnanswered: { windowStartIso: "2026-09-08T11:00:00.000Z", windowEndIso: "2026-09-08T13:00:00.000Z", prefill: {} },
    });
    const { client, rpcCalls } = makeClient();

    const result = await saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 30 });

    expect(rpcCalls[0][1]).toMatchObject({ p_window_start: "2026-09-08T11:00:00.000Z", p_window_end: "2026-09-08T13:00:00.000Z" });
    expect(result.wasScheduledWindow).toBe(true);
  });

  it("falls back to an ad-hoc 120-minute window ending now when nothing is pending or recent — same size the real UI's own ad-hoc fallback uses", async () => {
    getPendingAllocationQueueMock.mockResolvedValue(EMPTY_QUEUE);
    const { client, rpcCalls } = makeClient();
    const now = new Date("2026-09-08T15:05:00.000Z");

    const result = await saveAllocationCheckinCore(client, "user-1", now, { deen: 30 });

    expect(rpcCalls[0][1]).toMatchObject({ p_window_start: "2026-09-08T13:05:00.000Z", p_window_end: "2026-09-08T15:05:00.000Z" });
    expect(result.wasScheduledWindow).toBe(false);
  });

  it("passes supabaseDataSource(supabase), never the default cookie-based data source — core() must never touch cookies", async () => {
    getPendingAllocationQueueMock.mockResolvedValue(EMPTY_QUEUE);
    const { client } = makeClient();

    await saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), {});

    expect(getPendingAllocationQueueMock).toHaveBeenCalledWith("user-1", expect.any(Date), expect.objectContaining({ __marker: "supabaseDataSource" }));
  });
});

describe("saveAllocationCheckinCore — allocation validation (refuses before the RPC, never a raw constraint violation)", () => {
  beforeEach(() => {
    getPendingAllocationQueueMock.mockResolvedValue(EMPTY_QUEUE);
  });

  it("rejects 'wasted' as an allocation key with a clear, self-correcting message — never lets it reach the RPC", async () => {
    const { client, rpcCalls } = makeClient();
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { wasted: 30 })).rejects.toThrow(/not a real domain/i);
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { wasted: 30 })).rejects.toThrow(/never pass "wasted"/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects an unknown domain key the same way", async () => {
    const { client } = makeClient();
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { sleep: 30 })).rejects.toThrow(/not a real domain/i);
  });

  it("rejects a non-multiple-of-15 minute value", async () => {
    const { client } = makeClient();
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 22 })).rejects.toThrow(/multiple of 15/i);
  });

  it("rejects a negative minute value", async () => {
    const { client } = makeClient();
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: -15 })).rejects.toThrow(/multiple of 15/i);
  });

  it("rejects a total over the 120-minute pool", async () => {
    const { client } = makeClient();
    await expect(
      saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 90, business: 60 })
    ).rejects.toThrow(/more than the 120-minute pool/i);
  });

  it("derives wasted minutes automatically — never accepted as caller input, never reachable as a settable field", async () => {
    const { client, rpcCalls } = makeClient();
    const result = await saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 30, business: 45 });
    expect(rpcCalls[0][1]).toMatchObject({ p_allocations: { deen: 30, business: 45 }, p_wasted_minutes: 45 });
    expect(result.wastedMinutes).toBe(45);
  });

  it("an empty allocation map is valid — everything wasted, not an error", async () => {
    const { client, rpcCalls } = makeClient();
    const result = await saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), {});
    expect(rpcCalls[0][1]).toMatchObject({ p_allocations: {}, p_wasted_minutes: 120 });
    expect(result.wastedMinutes).toBe(120);
  });
});

describe("saveAllocationCheckinCore — RPC error propagation", () => {
  it("throws the real Supabase error, never swallows it", async () => {
    getPendingAllocationQueueMock.mockResolvedValue(EMPTY_QUEUE);
    const { client } = makeClient({ rpcError: { message: "constraint violated" } });
    await expect(saveAllocationCheckinCore(client, "user-1", new Date("2026-09-08T15:05:00Z"), { deen: 15 })).rejects.toMatchObject({
      message: "constraint violated",
    });
  });
});
