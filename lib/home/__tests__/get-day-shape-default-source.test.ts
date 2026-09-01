import { describe, expect, it, vi } from "vitest";

// Separate file so this can mock @/lib/supabase/server at module level
// without colliding with get-day-shape.test.ts's static import of the real
// module. Proves the real query bounds a *local* day, not a UTC day — a
// UTC-only fixture would pass either the buggy or fixed implementation and
// prove nothing, so this specifically uses a timezone whose offset crosses
// the UTC-date boundary (Chicago, UTC-5 in August).

function makeChain(resolvedValue: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte"]) {
    chain[method] = vi.fn(() => chain);
  }
  // .lt() is no longer terminal — a final .eq("counts_toward_hours", true)
  // follows it (deep-work-class only, so a retrieval review is never drawn on
  // the ribbon as a Focus block). Keep .lt chainable AND awaitable so this
  // file keeps testing local-day bounds rather than accidentally testing the
  // chain shape.
  chain.lt = vi.fn(() => chain);
  chain.eq = vi.fn(() => Object.assign(Promise.resolve(resolvedValue), chain));
  return chain;
}

describe("defaultDataSource().getFocusSessions", () => {
  it("bounds the query by the LOCAL day, not the UTC day — a 22:45-local session must fall within its own local day's range", async () => {
    vi.resetModules();
    const chain = makeChain({ data: [], error: null });
    const fromMock = vi.fn(() => chain);
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ from: fromMock }),
    }));

    const { defaultDataSource } = await import("../get-day-shape");
    await defaultDataSource().getFocusSessions("user-1", "2026-08-17", "America/Chicago");

    expect(fromMock).toHaveBeenCalledWith("work_sessions");
    // 2026-08-17 00:00 CDT (UTC-5) is 2026-08-17T05:00:00.000Z, not
    // 2026-08-17T00:00:00.000Z — the bug this fixes used the latter.
    expect(chain.gte).toHaveBeenCalledWith("started_at", "2026-08-17T05:00:00.000Z");
    // The end bound is the *next* local day's midnight, exclusive (lt, not
    // lte) — a session starting exactly at that instant belongs to the
    // next day, not this one.
    expect(chain.lt).toHaveBeenCalledWith("started_at", "2026-08-18T05:00:00.000Z");

    vi.doUnmock("@/lib/supabase/server");
  });

  it("a session at 22:45 local time falls strictly within its own local day's [start, end) range", () => {
    // Direct proof of the boundary math itself, independent of the mock:
    // 2026-08-17T22:45:00 CDT (local) = 2026-08-18T03:45:00Z.
    const sessionUtc = new Date("2026-08-18T03:45:00.000Z");
    const localDayStart = new Date("2026-08-17T05:00:00.000Z");
    const localDayEnd = new Date("2026-08-18T05:00:00.000Z");

    expect(sessionUtc.getTime()).toBeGreaterThanOrEqual(localDayStart.getTime());
    expect(sessionUtc.getTime()).toBeLessThan(localDayEnd.getTime());

    // And the bug this replaces — a naive UTC-date range — would have
    // excluded it, since its UTC date (08-18) differs from its local date
    // (08-17): the buggy range for local date "2026-08-17" was
    // [2026-08-17T00:00Z, 2026-08-17T23:59:59.999Z), which this session
    // (2026-08-18T03:45Z) falls entirely outside of.
    const buggyRangeStart = new Date("2026-08-17T00:00:00.000Z");
    const buggyRangeEnd = new Date("2026-08-17T23:59:59.999Z");
    expect(sessionUtc.getTime()).toBeGreaterThan(buggyRangeEnd.getTime());
    expect(sessionUtc.getTime()).toBeGreaterThanOrEqual(buggyRangeStart.getTime());
  });
});
