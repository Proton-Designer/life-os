import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "ilike", "insert", "update", "upsert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolvedValue);
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
let rpcMock = vi.fn(async () => ({ data: null, error: null }));
const fromMock = vi.fn((table: string) => fromImpl(table));
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: getClaimsMock },
    from: fromMock,
    rpc: (...args: unknown[]) => rpcMock(...(args as [string, unknown])),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const PROFILE_CHAIN = makeChain({ data: { timezone: "America/Chicago" }, error: null });

function tableRouter(overrides: Record<string, ReturnType<typeof makeChain>> = {}) {
  return (table: string) => {
    if (table === "profiles") return PROFILE_CHAIN;
    return overrides[table] ?? makeChain();
  };
}

/**
 * recordPlanOutcome is a thin pass-through to record_plan_outcome
 * (043_record_plan_outcome_atomic.sql) — the actual newPlanBody-required
 * and forced-rewrite guards live inside that single-transaction RPC now
 * (Lead review, 2026-08-24: a two-round-trip version could reject a
 * missing newPlanBody AFTER already writing the outcome row, deadlocking
 * a retry against trigger_plan_outcomes_one_per_day). These tests cover
 * the JS-side forwarding and error propagation; the RPC's own guard logic
 * is exercised live against the real DB, not mocked here.
 */
describe("recordPlanOutcome", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    revalidatePathMock.mockClear();
    fromImpl = tableRouter();
    rpcMock = vi.fn(async () => ({ data: null, error: null }));
  });

  it("forwards triggerId/followed/date/newPlanBody to record_plan_outcome, never client-computed counts", async () => {
    const { recordPlanOutcome } = await import("../actions");

    await recordPlanOutcome({ triggerId: "t1", followed: true, newPlanBody: "Smaller plan" });

    expect(rpcMock).toHaveBeenCalledWith("record_plan_outcome", {
      p_trigger_id: "t1",
      p_followed: true,
      p_date: expect.any(String),
      p_new_plan_body: "Smaller plan",
    });
  });

  it("omits newPlanBody as null when not provided", async () => {
    const { recordPlanOutcome } = await import("../actions");

    await recordPlanOutcome({ triggerId: "t1", followed: false });

    expect(rpcMock).toHaveBeenCalledWith(
      "record_plan_outcome",
      expect.objectContaining({ p_trigger_id: "t1", p_followed: false, p_new_plan_body: null })
    );
  });

  it("surfaces the RPC's rejection (e.g. missing newPlanBody) as a thrown error, not a silent no-op", async () => {
    rpcMock = vi.fn(async () => ({ data: null, error: { message: "newPlanBody is required when followed is true" } }));
    const { recordPlanOutcome } = await import("../actions");

    await expect(recordPlanOutcome({ triggerId: "t1", followed: true })).rejects.toThrow(/newPlanBody/);
  });

  it("makes a single RPC call — no separate outcome insert from the action layer", async () => {
    const { recordPlanOutcome } = await import("../actions");

    await recordPlanOutcome({ triggerId: "t1", followed: false, newPlanBody: "Rewritten" });

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
