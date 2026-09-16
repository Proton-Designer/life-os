import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEveningCloseCore, getEveningClosesForRange, bucketEfficiencyByClosedDay, type DayForEfficiencySplit } from "../closed-day";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "gte", "lt"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("recordEveningCloseCore — idempotent close mark (P3-09)", () => {
  it("upserts with ignoreDuplicates on (user_id, local_date), never a plain insert or a moving upsert", async () => {
    const eveningCloses = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => eveningCloses) } as unknown as SupabaseClient;
    const now = new Date("2026-09-14T23:10:00.000Z");

    await recordEveningCloseCore(client, "user-1", "2026-09-14", now);

    expect(eveningCloses.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", local_date: "2026-09-14", closed_at: now.toISOString() },
      { onConflict: "user_id,local_date", ignoreDuplicates: true }
    );
  });

  it("throws on a genuine upsert error rather than swallowing it", async () => {
    const eveningCloses = makeChain({ data: null, error: new Error("db down") });
    const client = { from: vi.fn(() => eveningCloses) } as unknown as SupabaseClient;

    await expect(recordEveningCloseCore(client, "user-1", "2026-09-14", new Date())).rejects.toThrow("db down");
  });
});

describe("getEveningClosesForRange", () => {
  it("returns a Map keyed by local_date, scoped to the given range", async () => {
    const eveningCloses = makeChain({
      data: [{ local_date: "2026-09-09", closed_at: "2026-09-09T23:30:00.000Z" }],
      error: null,
    });
    const client = { from: vi.fn(() => eveningCloses) } as unknown as SupabaseClient;

    const result = await getEveningClosesForRange(client, "user-1", "2026-09-08", "2026-09-15");

    expect(eveningCloses.gte).toHaveBeenCalledWith("local_date", "2026-09-08");
    expect(eveningCloses.lt).toHaveBeenCalledWith("local_date", "2026-09-15");
    expect(result).toEqual(new Map([["2026-09-09", "2026-09-09T23:30:00.000Z"]]));
  });

  it("throws rather than swallowing a query error", async () => {
    const eveningCloses = makeChain({ data: null, error: new Error("boom") });
    const client = { from: vi.fn(() => eveningCloses) } as unknown as SupabaseClient;

    await expect(getEveningClosesForRange(client, "user-1", "2026-09-08", "2026-09-15")).rejects.toThrow("boom");
  });
});

describe("bucketEfficiencyByClosedDay", () => {
  function day(overrides: Partial<DayForEfficiencySplit> = {}): DayForEfficiencySplit {
    return { localDate: "2026-09-08", hoursMinutes: 0, wokeAtIso: null, closedAtIso: null, ...overrides };
  }

  it("a day with neither a wake mark nor a close mark is out of scope entirely -- not counted as open", () => {
    const result = bucketEfficiencyByClosedDay([day()]);
    expect(result).toEqual({ closedAvgPercent: null, closedCount: 0, openCount: 0 });
  });

  it("a day with a wake mark and no close mark counts as OPEN, with no fabricated percent", () => {
    const result = bucketEfficiencyByClosedDay([day({ wokeAtIso: "2026-09-08T13:00:00.000Z", hoursMinutes: 120 })]);
    expect(result).toEqual({ closedAvgPercent: null, closedCount: 0, openCount: 1 });
  });

  it("a day with both marks computes a real efficiency and counts as CLOSED", () => {
    // wake 13:00, close 15:00 -> 120 min delta; 60 min of hours -> 50%.
    const result = bucketEfficiencyByClosedDay([
      day({ wokeAtIso: "2026-09-08T13:00:00.000Z", closedAtIso: "2026-09-08T15:00:00.000Z", hoursMinutes: 60 }),
    ]);
    expect(result).toEqual({ closedAvgPercent: 50, closedCount: 1, openCount: 0 });
  });

  it("averages across multiple closed days", () => {
    const result = bucketEfficiencyByClosedDay([
      // 60/120 = 50%
      day({ localDate: "d1", wokeAtIso: "2026-09-08T13:00:00.000Z", closedAtIso: "2026-09-08T15:00:00.000Z", hoursMinutes: 60 }),
      // 90/120 = 75%
      day({ localDate: "d2", wokeAtIso: "2026-09-09T13:00:00.000Z", closedAtIso: "2026-09-09T15:00:00.000Z", hoursMinutes: 90 }),
    ]);
    expect(result.closedAvgPercent).toBe(63); // round((50+75)/2)
    expect(result.closedCount).toBe(2);
  });

  it("a mix of closed and open days reports both, honestly", () => {
    const result = bucketEfficiencyByClosedDay([
      day({ localDate: "d1", wokeAtIso: "2026-09-08T13:00:00.000Z", closedAtIso: "2026-09-08T15:00:00.000Z", hoursMinutes: 60 }),
      day({ localDate: "d2", wokeAtIso: "2026-09-09T13:00:00.000Z", hoursMinutes: 30 }),
      day({ localDate: "d3" }),
    ]);
    expect(result).toEqual({ closedAvgPercent: 50, closedCount: 1, openCount: 1 });
  });

  it("a closed day whose delta produces no meaningful efficiency (closed_at before woke_at) is excluded from the average, not counted as 0%", () => {
    const result = bucketEfficiencyByClosedDay([
      day({ wokeAtIso: "2026-09-08T15:00:00.000Z", closedAtIso: "2026-09-08T13:00:00.000Z", hoursMinutes: 60 }),
    ]);
    expect(result).toEqual({ closedAvgPercent: null, closedCount: 0, openCount: 0 });
  });

  it("an empty week reports all-null/zero, never throws", () => {
    expect(bucketEfficiencyByClosedDay([])).toEqual({ closedAvgPercent: null, closedCount: 0, openCount: 0 });
  });
});
