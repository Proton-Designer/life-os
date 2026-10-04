import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn<(...args: unknown[]) => Promise<{ data: string | null; error: Error | null }>>(
  async () => ({ data: "checkin-1", error: null })
);
let deenModeValue: boolean | null = true;
const profileChain: Record<string, unknown> = {};
profileChain.select = vi.fn(() => profileChain);
profileChain.eq = vi.fn(() => profileChain);
profileChain.maybeSingle = vi.fn(async () => ({ data: { deen_mode: deenModeValue }, error: null }));
const supabaseMock = { rpc: rpcMock, from: vi.fn(() => profileChain) };
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: supabaseMock, userId: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getPendingAllocationQueueMock = vi.fn(async (_userId: string, _now: Date) => ({
  items: [] as unknown[],
  unknownCount: 0,
  timezone: "UTC",
}));
vi.mock("@/lib/checkins/get-allocation-queue", () => ({
  getPendingAllocationQueue: (userId: string, now: Date) => getPendingAllocationQueueMock(userId, now),
}));

describe("saveAllocationCheckin", () => {
  beforeEach(() => vi.clearAllMocks());

  // Ruling (a): the accounting value travels as its own p_wasted_minutes
  // param now, never embedded as a "wasted" key inside the domain-keyed
  // p_allocations map — that embedding was the write-path instance of the
  // sentinel-sharing-a-namespace bug (108_split_wasted_allocation_sentinel.sql).
  it("calls the save_allocation_checkin RPC with the window, domain allocations, and wasted minutes as a separate param", async () => {
    rpcMock.mockResolvedValue({ data: "checkin-1", error: null });
    const { saveAllocationCheckin } = await import("../allocation-actions");

    await saveAllocationCheckin("2026-08-19T13:00:00.000Z", "2026-08-19T15:00:00.000Z", {
      deen: 15,
      business: 30,
      school: 0,
      fitness: 0,
      co_op: 0,
    });

    expect(rpcMock).toHaveBeenCalledWith("save_allocation_checkin", {
      p_window_start: "2026-08-19T13:00:00.000Z",
      p_window_end: "2026-08-19T15:00:00.000Z",
      p_allocations: { deen: 15, business: 30, school: 0, fitness: 0, co_op: 0 },
      p_wasted_minutes: 75,
    });
  });

  it("Deen Mode OFF: Deen minutes are refused before the RPC; ON (positive control) saves; OFF with deen 0 saves", async () => {
    const { saveAllocationCheckin } = await import("../allocation-actions");
    const win: [string, string] = ["2026-08-19T13:00:00.000Z", "2026-08-19T15:00:00.000Z"];

    deenModeValue = false;
    await expect(saveAllocationCheckin(...win, { deen: 15, business: 0 })).rejects.toThrow(/Deen Mode is off/);
    expect(rpcMock).not.toHaveBeenCalled();

    await saveAllocationCheckin(...win, { deen: 0, business: 30 });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // F1: a non-number deen value ("30") must not slip past the gate -- jsonb casts it to minutes.
    for (const sneaky of ["30", "1", 30.5, true, [15]]) {
      await expect(saveAllocationCheckin(...win, { deen: sneaky } as never)).rejects.toThrow(/Deen Mode is off/);
    }
    expect(rpcMock).toHaveBeenCalledTimes(1);
    // null / 0 are "no Deen minutes".
    await saveAllocationCheckin(...win, { deen: null, business: 15 } as never);
    expect(rpcMock).toHaveBeenCalledTimes(2);

    deenModeValue = true;
    await saveAllocationCheckin(...win, { deen: 15 });
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the RPC errors, rather than silently swallowing it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { saveAllocationCheckin } = await import("../allocation-actions");

    await expect(
      saveAllocationCheckin("2026-08-19T13:00:00.000Z", "2026-08-19T15:00:00.000Z", {
        deen: 0,
        business: 0,
        school: 0,
        fitness: 0,
        co_op: 0,
      })
    ).rejects.toThrow("boom");
  });
});

describe("getAllocationQueueForNow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves `now` from the ISO string and delegates to getPendingAllocationQueue for the authed user", async () => {
    const { getAllocationQueueForNow } = await import("../allocation-actions");
    await getAllocationQueueForNow("2026-08-19T17:00:00.000Z");

    expect(getPendingAllocationQueueMock).toHaveBeenCalledTimes(1);
    const [userId, now] = getPendingAllocationQueueMock.mock.calls[0];
    expect(userId).toBe("user-1");
    expect((now as Date).toISOString()).toBe("2026-08-19T17:00:00.000Z");
  });
});
