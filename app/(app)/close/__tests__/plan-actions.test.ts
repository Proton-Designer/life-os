import { beforeEach, describe, expect, it, vi } from "vitest";

// A chain that records every call made on it (method + args, in order) and
// resolves via `.then` — good enough to assert both WHAT was called and in
// WHAT SHAPE, which matters here specifically because #29's fix is "one
// upsert, not a loop of per-id updates."
type Call = { method: string; args: unknown[] };

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }, calls: Call[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "insert", "update", "upsert", "order", "limit"]) {
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
const fromMock = vi.fn(() => nextChain());
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

  describe("savePlanRanks — the atomicity fix", () => {
    it("clears stale ranks with ONE update, then assigns new ranks with ONE upsert — never a per-id loop", async () => {
      nextChain = () => makeChain({ data: null, error: null }, calls);
      const { savePlanRanks } = await import("../plan-actions");
      const res = await savePlanRanks(["a", "b", "c"], "b");
      expect(res).toEqual({ ok: true });

      const updateCalls = calls.filter((c) => c.method === "update");
      const upsertCalls = calls.filter((c) => c.method === "upsert");
      // Exactly one clearing update (mit_rank -> null) and exactly one upsert
      // carrying ALL ranked rows -- not three separate update calls, which is
      // the exact defect the architect named ("a mid-loop failure leaves a
      // half-plan with no error surfaced").
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.args[0]).toEqual({ mit_rank: null });
      expect(upsertCalls).toHaveLength(1);
      const rows = upsertCalls[0]!.args[0] as { id: string; mit_rank: number }[];
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.id === "b")!.mit_rank).toBe(1); // crown is rank 1
      expect(rows.find((r) => r.id === "a")!.mit_rank).toBe(2);
      expect(rows.find((r) => r.id === "c")!.mit_rank).toBe(3);
    });

    it("revalidates /open — the previously-missing path a replan launched from /open needs", async () => {
      nextChain = () => makeChain({ data: null, error: null }, calls);
      const { savePlanRanks } = await import("../plan-actions");
      await savePlanRanks(["a"], "a");
      expect(revalidatePathMock).toHaveBeenCalledWith("/open");
    });

    it("surfaces a loud, specific error when the upsert step fails after the clear already ran", async () => {
      let call = 0;
      nextChain = () => {
        call += 1;
        // First from() call in savePlanRanks is the clear (succeeds); second is the upsert (fails).
        return makeChain(call === 1 ? { data: null, error: null } : { data: null, error: { message: "boom" } }, calls);
      };
      const { savePlanRanks } = await import("../plan-actions");
      const res = await savePlanRanks(["a"], "a");
      expect(res).toEqual({ error: expect.stringContaining("Try Finish again") });
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
