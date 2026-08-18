import { describe, expect, it, vi } from "vitest";

// A separate file (not the main get-domain-snapshots.test.ts) so this can
// mock @/lib/supabase/server at module level without colliding with that
// file's static import of the real, unmocked module.
//
// What this proves: `prayers.status` defaults to 'pending' in the live
// schema — a row that exists but was never actually logged. The qada
// head-count optimization's correctness depends entirely on the query
// filtering to exactly on_time/qada, so a 'pending' (or 'missed') row
// falls out of the handled count and is counted as backlog by elimination.
// No such row exists in the seed data today, so nothing exercises this
// path live — it would rot silently without a test pinning the query shape.

function makeChain(resolvedValue: { count: number | null; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lte"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.in = vi.fn(async () => resolvedValue);
  return chain;
}

describe("defaultDataSource().getPrayerHandledCount", () => {
  it("filters to exactly on_time/qada — a pending-defaulted or missed row must not count as handled", async () => {
    vi.resetModules();
    const chain = makeChain({ count: 3, error: null });
    const fromMock = vi.fn(() => chain);
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: fromMock }),
    }));

    const { defaultDataSource } = await import("../get-domain-snapshots");
    const count = await defaultDataSource().getPrayerHandledCount("user-1", "2026-01-01", "2026-01-31");

    expect(fromMock).toHaveBeenCalledWith("prayers");
    expect(chain.in).toHaveBeenCalledWith("status", ["on_time", "qada"]);
    expect(count).toBe(3);

    vi.doUnmock("@/lib/supabase/server");
  });

  it("treats a null count (no matching rows) as zero handled, not a crash", async () => {
    vi.resetModules();
    const chain = makeChain({ count: null, error: null });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: vi.fn(() => chain) }),
    }));

    const { defaultDataSource } = await import("../get-domain-snapshots");
    const count = await defaultDataSource().getPrayerHandledCount("user-1", "2026-01-01", "2026-01-31");

    expect(count).toBe(0);

    vi.doUnmock("@/lib/supabase/server");
  });
});
