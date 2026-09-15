import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Proves lib/rescuetime/client.ts routes every outbound request through
 * lib/net/safe-outbound-url.ts's `safeFetch`, never Node's raw `fetch`
 * directly -- same convention lib/canvas/client.ts's own test file
 * established (P2-20 security review), applied here even though
 * RescueTime's host is fixed (P3-19 instruction, a9): uniform use of the
 * one "safe outbound call" utility, not a per-integration judgment call.
 */

const safeFetchMock = vi.fn();
vi.mock("@/lib/net/safe-outbound-url", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

const { verifyRescueTimeKey, fetchDailySummaries } = await import("@/lib/rescuetime/client");

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-09-14",
    productivity_pulse: 65,
    very_productive_percentage: "20.5",
    productive_percentage: "30.2",
    neutral_percentage: "25.0",
    distracting_percentage: "15.0",
    very_distracting_percentage: "9.3",
    total_hours: "8.5",
    ...overrides,
  };
}

describe("RescueTime client routes through the SSRF-safe fetch wrapper", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("fetchDailySummaries calls safeFetch against the fixed RescueTime host, not raw fetch", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify([summaryRow()]), { status: 200 }));
    const res = await fetchDailySummaries("rt-key");
    expect(res.ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(String(safeFetchMock.mock.calls[0]![0])).toContain("https://www.rescuetime.com/anapi/daily_summary_feed");
    expect(String(safeFetchMock.mock.calls[0]![0])).toContain("key=rt-key");
  });

  it("parses percentages and pulse into numbers, dropping RescueTime's own string-typed fields", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify([summaryRow()]), { status: 200 }));
    const res = await fetchDailySummaries("rt-key");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([
        {
          date: "2026-09-14",
          productivityPulse: 65,
          veryProductivePct: 20.5,
          productivePct: 30.2,
          neutralPct: 25.0,
          distractingPct: 15.0,
          veryDistractingPct: 9.3,
          totalHours: 8.5,
        },
      ]);
    }
  });

  it("treats 401/403 as a clean rejected-key result", async () => {
    safeFetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await fetchDailySummaries("bad-key");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/rejected/i);
  });

  it("rejects a non-array response instead of crashing on .map", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "not an array" }), { status: 200 }));
    const res = await fetchDailySummaries("rt-key");
    expect(res.ok).toBe(false);
  });

  it("surfaces a safeFetch rejection (SSRF-blocked/unreachable) as a clean {ok:false} result, never throws to the caller", async () => {
    safeFetchMock.mockImplementationOnce(() => Promise.reject(new Error("That host can't be used.")));
    const res = await fetchDailySummaries("rt-key");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe("That host can't be used.");
  });

  it("verifyRescueTimeKey succeeds when the feed call succeeds, without a separate endpoint", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify([summaryRow()]), { status: 200 }));
    const res = await verifyRescueTimeKey("rt-key");
    expect(res).toEqual({ ok: true, data: true });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifyRescueTimeKey fails when the feed call fails", async () => {
    safeFetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await verifyRescueTimeKey("bad-key");
    expect(res.ok).toBe(false);
  });
});
