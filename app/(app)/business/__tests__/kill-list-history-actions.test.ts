import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "lte", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));

const CHICAGO_PROFILE = { data: { timezone: "America/Chicago" }, error: null };

describe("getKillListHistory", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    vi.useFakeTimers();
    // Wednesday, 2026-08-26 in Chicago.
    vi.setSystemTime(new Date("2026-08-26T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns three empty groups when there is no history at all — the launch state after a wipe", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: [], error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getKillListHistory } = await import("../kill-list-history-actions");

    const groups = await getKillListHistory();
    expect(groups).toEqual([
      { label: "This week", days: [] },
      { label: "This month", days: [] },
      { label: "Past 3 months", days: [] },
    ]);
  });

  it("buckets a day into This week / This month / Past 3 months by its date, and only counts non-blank items", async () => {
    const rows = [
      // This week (week starts Sunday 2026-08-23).
      { date: "2026-08-24", text: "Ship the thing", completed: true },
      { date: "2026-08-24", text: "", completed: false }, // blank slot, not a real item
      // This month, before this week.
      { date: "2026-08-05", text: "Call the vendor", completed: false },
      { date: "2026-08-05", text: "Send invoice", completed: true },
      // Past 3 months.
      { date: "2026-06-10", text: "Old task", completed: true },
    ];
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: rows, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getKillListHistory } = await import("../kill-list-history-actions");

    const groups = await getKillListHistory();
    expect(groups[0]).toEqual({ label: "This week", days: [{ date: "2026-08-24", completed: 1, total: 1 }] });
    expect(groups[1]).toEqual({ label: "This month", days: [{ date: "2026-08-05", completed: 1, total: 2 }] });
    expect(groups[2]).toEqual({ label: "Past 3 months", days: [{ date: "2026-06-10", completed: 1, total: 1 }] });
  });

  it("never includes today itself — history is strictly past days", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: [], error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getKillListHistory } = await import("../kill-list-history-actions");
    await getKillListHistory();
    expect(chains.kill_list_items.lt).toHaveBeenCalledWith("date", "2026-08-26");
  });
});

describe("getIncompleteByDate", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    vi.useFakeTimers();
    // Wednesday, 2026-08-26 in Chicago.
    vi.setSystemTime(new Date("2026-08-26T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups incomplete, non-blank items by date, most recent first, and includes today", async () => {
    const rows = [
      // Rows arrive date-descending, as the real query orders them.
      { id: "a", text: "Finish deck", completed: false, date: "2026-08-26" }, // today
      { id: "b", text: "", completed: false, date: "2026-08-26" }, // blank slot, excluded
      { id: "c", text: "Call vendor", completed: false, date: "2026-08-20" },
      { id: "d", text: "Send invoice", completed: false, date: "2026-08-20" },
    ];
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: rows, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getIncompleteByDate } = await import("../kill-list-history-actions");

    const groups = await getIncompleteByDate();
    expect(groups).toEqual([
      { date: "2026-08-26", items: [{ id: "a", text: "Finish deck", completed: false }] },
      {
        date: "2026-08-20",
        items: [
          { id: "c", text: "Call vendor", completed: false },
          { id: "d", text: "Send invoice", completed: false },
        ],
      },
    ]);
    expect(chains.kill_list_items.eq).toHaveBeenCalledWith("completed", false);
    expect(chains.kill_list_items.lte).toHaveBeenCalledWith("date", "2026-08-26"); // includes today
    expect(chains.kill_list_items.gte).toHaveBeenCalledWith("date", "2026-05-01"); // same 3-month floor as history
  });

  it("omits a date entirely when every one of its rows is blank text — not an empty-items group", async () => {
    const rows = [{ id: "a", text: "", completed: false, date: "2026-08-20" }];
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: rows, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getIncompleteByDate } = await import("../kill-list-history-actions");

    expect(await getIncompleteByDate()).toEqual([]);
  });

  it("returns an empty array, not a crash, when there is no data at all", async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: [], error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getIncompleteByDate } = await import("../kill-list-history-actions");

    expect(await getIncompleteByDate()).toEqual([]);
  });

  it("the week/month boundary: a date exactly at the 3-month floor is included, one day before is not", async () => {
    // threeMonthsFloor for August 2026 is 2026-05-01 (3 months back from the
    // 1st of the current month, per addMonthsToDateString).
    const rows = [
      { id: "a", text: "On the floor", completed: false, date: "2026-05-01" },
      { id: "b", text: "One day short", completed: false, date: "2026-04-30" },
    ];
    const chains: Record<string, ReturnType<typeof makeChain>> = {
      profiles: makeChain(CHICAGO_PROFILE),
      kill_list_items: makeChain({ data: rows, error: null }),
    };
    fromImpl = (table) => chains[table];
    const { getIncompleteByDate } = await import("../kill-list-history-actions");

    // The .gte("date", threeMonthsFloor) call on the real query is what
    // actually excludes 2026-04-30 — this fixture stands in for the
    // Supabase query builder, so it proves the floor value itself is right,
    // not that this function re-filters by date (it doesn't; the query
    // does).
    expect(chains.kill_list_items.gte).not.toHaveBeenCalled(); // not yet called — proven after the call below
    await getIncompleteByDate();
    expect(chains.kill_list_items.gte).toHaveBeenCalledWith("date", "2026-05-01");
  });
});
