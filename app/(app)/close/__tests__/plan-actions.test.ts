import { beforeEach, describe, expect, it, vi } from "vitest";

// A chain that records every call made on it (method + args, in order) and
// resolves via `.then` — good enough to assert both WHAT was called and in
// WHAT SHAPE, which matters here specifically because #29's fix is "one
// upsert, not a loop of per-id updates."
type Call = { method: string; args: unknown[] };

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }, calls: Call[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "insert", "update", "upsert", "order", "limit"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const getAuthedUserMock = vi.fn(async () => ({ id: "user-1", email: "u@example.com" }));
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago" }));
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: () => getAuthedUserMock(),
  getProfile: () => getProfileMock(),
}));

let calls: Call[] = [];
let nextChain = () => makeChain({ data: null, error: null }, calls);
// P3-09: evening_closes gets its OWN untracked chain, not the shared `calls`
// array -- every existing assertion in this file was written assuming
// `tasks` is the only table involved (e.g. "never an upsert"), and
// savePlanRanks's new recordEveningCloseCore call is a genuine upsert
// against a DIFFERENT table. Routing it separately keeps those assertions
// accurate without threading table names through `calls` everywhere else.
const fromMock = vi.fn((table: string) => (table === "evening_closes" ? makeChain({ data: null, error: null }) : nextChain()));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

// A fixed "now" so plannedDate assertions are deterministic regardless of
// when the test runs. 2026-09-14 22:00 UTC is 2026-09-14 17:00 in
// America/Chicago (UTC-5 in September, DST) -- safely mid-evening local, not
// near a day boundary either side.
const FIXED_NOW = new Date("2026-09-14T22:00:00Z");

describe("plan-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  describe("triageInboxItem (IA-P1a)", () => {
    const planned = () => (calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>).planned_date;

    it('"plan" uses the SERVER-derived planning day: tonight = local tomorrow, today = local today', async () => {
      nextChain = () => makeChain({ data: [{ id: "i1" }], error: null }, calls);
      const { triageInboxItem } = await import("../plan-actions");
      expect(await triageInboxItem("i1", "plan")).toEqual({ ok: true });
      expect(planned()).toBe("2026-09-15");
      calls.length = 0;
      await triageInboxItem("i1", "plan", "today");
      expect(planned()).toBe("2026-09-14");
    });

    it("maps school / co_op to a domain update and relays an already-sorted item as an error", async () => {
      nextChain = () => makeChain({ data: [], error: null }, calls);
      const { triageInboxItem } = await import("../plan-actions");
      expect(await triageInboxItem("i1", "co_op")).toEqual({ error: "That item was already sorted." });
      expect((calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>).domain).toBe("co_op");
    });

    it("signed out writes nothing", async () => {
      getAuthedUserMock.mockResolvedValueOnce(null as never);
      const { triageInboxItem } = await import("../plan-actions");
      expect(await triageInboxItem("i1", "done")).toEqual({ error: "Not signed in" });
      expect(calls.find((c) => c.method === "update")).toBeUndefined();
    });
  });

  describe("dumpLine — item #29's mode param", () => {
    it("defaults to TONIGHT: plans the user's local TOMORROW", async () => {
      nextChain = () => makeChain({ data: { id: "t1" }, error: null }, calls);
      const { dumpLine } = await import("../plan-actions");
      await dumpLine("Read chapter 4");
      const insertCall = calls.find((c) => c.method === "insert");
      expect((insertCall!.args[0] as { planned_date: string }).planned_date).toBe("2026-09-15");
    });

    it('mode "today" plans the user\'s local TODAY, no +1 — regression test for the /open Re-plan bug', async () => {
      nextChain = () => makeChain({ data: { id: "t1" }, error: null }, calls);
      const { dumpLine } = await import("../plan-actions");
      await dumpLine("Fix the thing now", "today");
      const insertCall = calls.find((c) => c.method === "insert");
      expect((insertCall!.args[0] as { planned_date: string }).planned_date).toBe("2026-09-14");
    });
  });

  // PERF-4: the dump is tap-rate; no inline re-render wait, one deferred data-free refresh.
  describe("dumpLine is lean; refreshCloseViews revalidates", () => {
    it("dumpLine does NOT revalidate inline", async () => {
      nextChain = () => makeChain({ data: { id: "t1" }, error: null }, calls);
      const { dumpLine } = await import("../plan-actions");
      await dumpLine("Read chapter 4");
      await dumpLine("Fix it now", "today");
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("refreshCloseViews revalidates /close and /close/replan and touches no table", async () => {
      const { refreshCloseViews } = await import("../plan-actions");
      await refreshCloseViews();
      expect(revalidatePathMock).toHaveBeenCalledWith("/close");
      expect(revalidatePathMock).toHaveBeenCalledWith("/close/replan");
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe("savePlanRanks — per-id UPDATE, not a partial-row upsert (P4-07 04 live-verification finding)", () => {
    // A partial-row `.upsert([{id,user_id,mit_rank}], {onConflict:"id"})`
    // looked atomic but isn't real: Postgres validates NOT NULL constraints
    // (title, planned_date, ...) on the candidate row BEFORE conflict
    // resolution even runs, so it failed on every plan that already had a
    // title -- i.e. always, in real use. Confirmed live in production on
    // both teamb accounts (isError, "violates not-null constraint"),
    // reproduced directly against Postgres with RLS and again with RLS
    // bypassed (service role) -- core Postgres upsert semantics, not an RLS
    // quirk. Fix: ranks are already cleared to null for this planned_date
    // before this runs, so a per-id UPDATE scoped to
    // (id, user_id, planned_date) can never collide with
    // tasks_mit_rank_per_day_idx, and never risks the NOT NULL trap because
    // an UPDATE's candidate row is only the columns actually being set.
    it("clears stale ranks with ONE update, then assigns each rank with its OWN scoped update — never an upsert", async () => {
      nextChain = () => makeChain({ data: [{ id: "row" }], error: null }, calls);
      const { savePlanRanks } = await import("../plan-actions");
      const res = await savePlanRanks(["a", "b", "c"], "b");
      expect(res).toEqual({ ok: true });

      const upsertCalls = calls.filter((c) => c.method === "upsert");
      expect(upsertCalls).toHaveLength(0);

      const updateCalls = calls.filter((c) => c.method === "update");
      // 1 clearing update (mit_rank -> null) + 1 per ranked id.
      expect(updateCalls).toHaveLength(4);
      expect(updateCalls[0]!.args[0]).toEqual({ mit_rank: null });
      const byRank = new Map(updateCalls.slice(1).map((c) => [(c.args[0] as { mit_rank: number }).mit_rank, c]));
      expect(byRank.get(1)).toBeDefined(); // crown is rank 1
      expect(byRank.size).toBe(3);

      // Each per-id update is scoped to id + user_id + planned_date -- the
      // scoping that makes a per-row UPDATE safe against
      // tasks_mit_rank_per_day_idx and against writing another user's row.
      const eqCallsAfterClear = calls.filter((c) => c.method === "eq").slice(2); // first 2 eq() calls belong to the clear
      const idEqs = eqCallsAfterClear.filter((c) => c.args[0] === "id").map((c) => c.args[1]);
      expect(idEqs.sort()).toEqual(["a", "b", "c"]);
    });

    it("revalidates /open — the previously-missing path a replan launched from /open needs", async () => {
      nextChain = () => makeChain({ data: [{ id: "row" }], error: null }, calls);
      const { savePlanRanks } = await import("../plan-actions");
      await savePlanRanks(["a"], "a");
      expect(revalidatePathMock).toHaveBeenCalledWith("/open");
    });

    it("surfaces a loud, specific error when a per-id update fails after the clear already ran", async () => {
      let call = 0;
      nextChain = () => {
        call += 1;
        // 1st from() is the clear (succeeds); 2nd is the one ranked id's update (fails).
        return makeChain(call === 1 ? { data: null, error: null } : { data: null, error: { message: "boom" } }, calls);
      };
      const { savePlanRanks } = await import("../plan-actions");
      const res = await savePlanRanks(["a"], "a");
      expect(res).toEqual({ error: expect.stringContaining("Try Finish again") });
    });

    it("surfaces an error, not a silent drop, when a ranked id updates 0 rows (not actually on today's plan)", async () => {
      let call = 0;
      nextChain = () => {
        call += 1;
        // 1st from() is the clear; 2nd is the per-id update, which matches nothing.
        return makeChain(call === 1 ? { data: null, error: null } : { data: [], error: null }, calls);
      };
      const { savePlanRanks } = await import("../plan-actions");
      const res = await savePlanRanks(["a"], "a");
      expect(res).toEqual({ error: expect.stringContaining("Try Finish again") });
    });
  });

  // P3-09: the ONE always-fires signal of "the evening close actually
  // happened" -- commit() (close-plan-stage.tsx) calls savePlanRanks on
  // Finish unconditionally, even with zero starred/crowned items.
  describe("savePlanRanks records the closed day (P3-09)", () => {
    it("mode 'tonight' (the default) records TODAY's local date as closed after a successful save", async () => {
      nextChain = () => makeChain({ data: [{ id: "row" }], error: null }, calls);
      const eveningClosesCalls: Call[] = [];
      fromMock.mockImplementation((table: string) =>
        table === "evening_closes" ? makeChain({ data: null, error: null }, eveningClosesCalls) : nextChain()
      );
      const { savePlanRanks } = await import("../plan-actions");

      await savePlanRanks(["a"], "a");

      const upsertCall = eveningClosesCalls.find((c) => c.method === "upsert");
      expect(upsertCall).toBeDefined();
      // FIXED_NOW (2026-09-14T22:00Z) is 2026-09-14 17:00 America/Chicago --
      // TODAY's own local date, never `plannedDate` (tomorrow, "2026-09-15").
      expect(upsertCall!.args[0]).toEqual({ user_id: "user-1", local_date: "2026-09-14", closed_at: FIXED_NOW.toISOString() });
      expect(upsertCall!.args[1]).toEqual({ onConflict: "user_id,local_date", ignoreDuplicates: true });
    });

    // Night owl: closing at 00:30 on Oct 5 closes Oct 4 (4 AM rollover) and plans tonight = Oct 5.
    it("a close at 00:30 local records the PREVIOUS day as closed and plans local today", async () => {
      vi.setSystemTime(new Date("2026-10-05T00:30:00-05:00"));
      nextChain = () => makeChain({ data: [{ id: "row" }], error: null }, calls);
      const eveningClosesCalls: Call[] = [];
      fromMock.mockImplementation((table: string) =>
        table === "evening_closes" ? makeChain({ data: null, error: null }, eveningClosesCalls) : nextChain()
      );
      const { savePlanRanks } = await import("../plan-actions");

      await savePlanRanks(["a"], "a");

      const upsertCall = eveningClosesCalls.find((c) => c.method === "upsert");
      expect((upsertCall!.args[0] as { local_date: string }).local_date).toBe("2026-10-04");
      expect(calls.some((c) => c.method === "eq" && c.args[0] === "planned_date" && c.args[1] === "2026-10-05")).toBe(true);
    });

    it("mode 'today' (a next-morning replan) does NOT record a closed day -- it fixes yesterday's plan, it isn't tonight's ceremony", async () => {
      nextChain = () => makeChain({ data: [{ id: "row" }], error: null }, calls);
      const eveningClosesCalls: Call[] = [];
      fromMock.mockImplementation((table: string) =>
        table === "evening_closes" ? makeChain({ data: null, error: null }, eveningClosesCalls) : nextChain()
      );
      const { savePlanRanks } = await import("../plan-actions");

      await savePlanRanks(["a"], "a", "today");

      // A read is fine (which day "today" is depends on whether it was closed); a WRITE would record a close.
      expect(eveningClosesCalls.filter((c) => c.method === "upsert" || c.method === "insert" || c.method === "update")).toHaveLength(0);
    });

    it("does NOT record a closed day when the plan save itself failed", async () => {
      nextChain = () => makeChain({ data: null, error: { message: "boom" } }, calls);
      const eveningClosesCalls: Call[] = [];
      fromMock.mockImplementation((table: string) =>
        table === "evening_closes" ? makeChain({ data: null, error: null }, eveningClosesCalls) : nextChain()
      );
      const { savePlanRanks } = await import("../plan-actions");

      const res = await savePlanRanks(["a"], "a");

      expect("error" in res).toBe(true);
      expect(eveningClosesCalls).toHaveLength(0);
    });
  });

  describe("claimSeedLines — #28/#45", () => {
    it("claims a worry seed by re-dating the SAME row, scoped to dump_source=worry and completed=false", async () => {
      nextChain = () => makeChain({ data: [{ id: "worry-1" }], error: null }, calls);
      const { claimSeedLines } = await import("../plan-actions");
      const res = await claimSeedLines([{ id: "worry-1", title: "Call the landlord", source: "worry" }]);
      expect("claimed" in res && res.claimed).toEqual([{ seedId: "worry-1", taskId: "worry-1" }]);
      const updateCall = calls.find((c) => c.method === "update");
      expect(updateCall!.args[0]).toEqual({ planned_date: "2026-09-15" });
      const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
      expect(eqCalls).toContainEqual(["dump_source", "worry"]);
      expect(eqCalls).toContainEqual(["completed", false]);
    });

    it("claims a goal_milestone seed by INSERTING a new row, and returns the new id remapped", async () => {
      nextChain = () => makeChain({ data: { id: "new-task-id" }, error: null }, calls);
      const { claimSeedLines } = await import("../plan-actions");
      const res = await claimSeedLines([{ id: "milestone-1", title: "Ship the thing", source: "goal_milestone" }]);
      expect("claimed" in res && res.claimed).toEqual([{ seedId: "milestone-1", taskId: "new-task-id" }]);
      const insertCall = calls.find((c) => c.method === "insert");
      expect(insertCall!.args[0]).toMatchObject({ dump_source: "milestone", title: "Ship the thing" });
    });

    it("drops a worry claimed by 0 rows (already handled elsewhere) rather than erroring", async () => {
      nextChain = () => makeChain({ data: [], error: null }, calls);
      const { claimSeedLines } = await import("../plan-actions");
      const res = await claimSeedLines([{ id: "worry-1", title: "Stale", source: "worry" }]);
      expect("claimed" in res && res.claimed).toEqual([]);
    });

    // #28 fix (2026-09-14): school_risk was computed and rendered but this branch never
    // existed — a Finish on a starred school seed had no way to persist it at all. Same
    // INSERT shape as goal_milestone, different dump_source (this file's own mapping
    // table: school_risk -> 'school').
    it("claims a school_risk seed by INSERTING a new row with dump_source='school', and returns the new id remapped", async () => {
      nextChain = () => makeChain({ data: { id: "new-task-id" }, error: null }, calls);
      const { claimSeedLines } = await import("../plan-actions");
      const res = await claimSeedLines([{ id: "assessment-1", title: "VERIFY-101 · Problem Set 3 · due Tue", source: "school_risk" }]);
      expect("claimed" in res && res.claimed).toEqual([{ seedId: "assessment-1", taskId: "new-task-id" }]);
      const insertCall = calls.find((c) => c.method === "insert");
      expect(insertCall!.args[0]).toMatchObject({ dump_source: "school", title: "VERIFY-101 · Problem Set 3 · due Tue" });
    });

    it("targets TODAY, not tomorrow, when claiming a school_risk seed in replan mode — same planningDate rule as any other seed", async () => {
      nextChain = () => makeChain({ data: { id: "new-task-id" }, error: null }, calls);
      const { claimSeedLines } = await import("../plan-actions");
      await claimSeedLines([{ id: "assessment-1", title: "Due today", source: "school_risk" }], "today");
      const insertCall = calls.find((c) => c.method === "insert");
      expect((insertCall!.args[0] as { planned_date: string }).planned_date).toBe("2026-09-14");
    });
  });
});
