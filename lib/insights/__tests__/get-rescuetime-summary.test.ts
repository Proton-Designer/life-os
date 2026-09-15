import { describe, it, expect, vi } from "vitest";
import { getRescueTimeInsightsData } from "../get-rescuetime-summary";

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (v: typeof result) => void) => resolve(result);
  return chain;
}

function makeFakeSupabase(tables: Record<string, { data: unknown; error: unknown }>) {
  return { from: vi.fn((table: string) => makeChain(tables[table] ?? { data: null, error: null })) };
}

describe("getRescueTimeInsightsData", () => {
  it("returns connected:false without querying the summaries table when there's no connection row", async () => {
    const supabase = makeFakeSupabase({ rescuetime_connections: { data: null, error: null } });
    const result = await getRescueTimeInsightsData(supabase as never, "user-1");
    expect(result).toEqual({ connected: false });
  });

  it("shapes camelCase rows, most-recent-first, when connected", async () => {
    const supabase = makeFakeSupabase({
      rescuetime_connections: { data: { last_synced_at: "2026-09-14T08:00:00Z", last_sync_error: null }, error: null },
      rescuetime_daily_summaries: {
        data: [
          { summary_date: "2026-09-14", productivity_pulse: 70, productive_percentage: 40, distracting_percentage: 10, total_hours: 9 },
          { summary_date: "2026-09-13", productivity_pulse: 55, productive_percentage: 30, distracting_percentage: 20, total_hours: 7.5 },
        ],
        error: null,
      },
    });

    const result = await getRescueTimeInsightsData(supabase as never, "user-1");

    expect(result).toEqual({
      connected: true,
      lastSyncedAt: "2026-09-14T08:00:00Z",
      lastSyncError: null,
      rows: [
        { date: "2026-09-14", productivityPulse: 70, productivePct: 40, distractingPct: 10, totalHours: 9 },
        { date: "2026-09-13", productivityPulse: 55, productivePct: 30, distractingPct: 20, totalHours: 7.5 },
      ],
    });
  });

  it("connected with zero synced rows yet returns an empty array, not an error", async () => {
    const supabase = makeFakeSupabase({
      rescuetime_connections: { data: { last_synced_at: null, last_sync_error: null }, error: null },
      rescuetime_daily_summaries: { data: [], error: null },
    });

    const result = await getRescueTimeInsightsData(supabase as never, "user-1");

    expect(result).toEqual({ connected: true, lastSyncedAt: null, lastSyncError: null, rows: [] });
  });

  it("throws on a real DB error instead of returning a fabricated disconnected/empty state", async () => {
    const supabase = makeFakeSupabase({ rescuetime_connections: { data: null, error: { message: "connection reset" } } });
    await expect(getRescueTimeInsightsData(supabase as never, "user-1")).rejects.toEqual({ message: "connection reset" });
  });
});
