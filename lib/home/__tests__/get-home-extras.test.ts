import { describe, expect, it, vi } from "vitest";

// getHomeExtras has no injectable DataSource — it calls createClient()
// directly — so proving its query bounds are correct needs a Supabase
// client mock, same approach as get-day-shape's sibling boundary test.

function makeChain(resolvedValue: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.lt = vi.fn(async () => resolvedValue);
  return chain;
}

describe("getHomeExtras", () => {
  it("bounds today's focus-time query by the LOCAL day, not a naive UTC-date string", async () => {
    vi.resetModules();
    const chain = makeChain({ data: [], error: null });
    const fromMock = vi.fn(() => chain);
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: fromMock }),
    }));

    const { getHomeExtras } = await import("../get-home-extras");
    // 2026-08-17T22:00:00 CDT (UTC-5) — an evening instant whose local date
    // (08-17) and UTC date (08-18) disagree, exactly the case the bug hid.
    const now = new Date("2026-08-18T03:00:00.000Z");
    await getHomeExtras("user-1", now, { timezone: "America/Chicago" });

    expect(fromMock).toHaveBeenCalledWith("work_sessions");
    // Local midnight of 2026-08-17 in Chicago is 2026-08-17T05:00:00Z, not
    // the UTC-string bug's 2026-08-17T00:00:00Z.
    expect(chain.gte).toHaveBeenCalledWith("started_at", "2026-08-17T05:00:00.000Z");
    expect(chain.lt).toHaveBeenCalledWith("started_at", "2026-08-18T05:00:00.000Z");

    vi.doUnmock("@/lib/supabase/server");
  });

  it("splits focus time and session count by kind, deep_work and deep_study counted separately", async () => {
    vi.resetModules();
    const chain = makeChain({
      data: [
        { started_at: "2026-08-17T14:00:00Z", ended_at: "2026-08-17T15:00:00Z", kind: "deep_work" },
        { started_at: "2026-08-17T16:00:00Z", ended_at: "2026-08-17T16:30:00Z", kind: "deep_study" },
        { started_at: "2026-08-17T17:00:00Z", ended_at: "2026-08-17T17:20:00Z", kind: "deep_study" },
      ],
      error: null,
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: vi.fn(() => chain) }),
    }));

    const { getHomeExtras } = await import("../get-home-extras");
    const now = new Date("2026-08-17T20:00:00.000Z");
    const result = await getHomeExtras("user-1", now, { timezone: "America/Chicago" });

    expect(result.deepWork).toEqual({ minutes: 60, sessions: 1 });
    expect(result.deepStudy).toEqual({ minutes: 50, sessions: 2 });

    vi.doUnmock("@/lib/supabase/server");
  });

  it("returns zeroed extras for both kinds when no sessions exist today", async () => {
    vi.resetModules();
    const chain = makeChain({ data: [], error: null });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: vi.fn(() => chain) }),
    }));

    const { getHomeExtras } = await import("../get-home-extras");
    const now = new Date("2026-08-17T20:00:00.000Z");
    const result = await getHomeExtras("user-1", now, { timezone: "America/Chicago" });

    expect(result.deepWork).toEqual({ minutes: 0, sessions: 0 });
    expect(result.deepStudy).toEqual({ minutes: 0, sessions: 0 });

    vi.doUnmock("@/lib/supabase/server");
  });
});
