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
type RpcResult = { data: unknown; error: { message: string } | null };
let rpcMock: ReturnType<typeof vi.fn<(name: string, args?: unknown) => Promise<RpcResult>>> = vi.fn(async () => ({
  data: null,
  error: null,
}));
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

  it("leaves newPlanBody undefined when not provided (RPC default applies)", async () => {
    const { recordPlanOutcome } = await import("../actions");

    await recordPlanOutcome({ triggerId: "t1", followed: false });

    expect(rpcMock).toHaveBeenCalledWith(
      "record_plan_outcome",
      expect.objectContaining({ p_trigger_id: "t1", p_followed: false, p_new_plan_body: undefined })
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

/**
 * #52: distraction_events.session_id (migration 169) — logDistraction/
 * createTriggerAndLog thread an optional session id through to the insert,
 * and getSessionDistractionCountForNow reads it back scoped to one user's
 * one session.
 */
describe("#52 session linkage", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
    revalidatePathMock.mockClear();
    rpcMock = vi.fn(async () => ({ data: null, error: null }));
  });

  it("logDistraction writes session_id when an active session id is passed", async () => {
    const eventsChain = makeChain({ data: { id: "event-1" }, error: null });
    fromImpl = tableRouter({ distraction_events: eventsChain });
    const { logDistraction } = await import("../actions");

    await logDistraction("trig-1", undefined, "session-1");

    expect(eventsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: "session-1" }));
  });

  it("logDistraction writes session_id: null when no session id is passed", async () => {
    const eventsChain = makeChain({ data: { id: "event-1" }, error: null });
    fromImpl = tableRouter({ distraction_events: eventsChain });
    const { logDistraction } = await import("../actions");

    await logDistraction("trig-1");

    expect(eventsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: null }));
  });

  it("createTriggerAndLog threads input.sessionId through to the event insert", async () => {
    const triggersChain = makeChain({ data: { id: "trig-new" }, error: null });
    const eventsChain = makeChain({ data: { id: "event-1" }, error: null });
    fromImpl = tableRouter({ distraction_triggers: triggersChain, distraction_events: eventsChain });
    const { createTriggerAndLog } = await import("../actions");

    await createTriggerAndLog({ domain: "business", name: "Slack", description: null, sessionId: "session-2" });

    expect(eventsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: "session-2" }));
  });

  it("getSessionDistractionCountForNow scopes the count to this user and this session id", async () => {
    const eqSpy = vi.fn();
    const rawChain: Record<string, unknown> = {};
    rawChain.select = vi.fn(() => rawChain);
    rawChain.eq = vi.fn((...args: unknown[]) => {
      eqSpy(...args);
      return rawChain;
    });
    rawChain.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count: 4, error: null });
    fromImpl = tableRouter({ distraction_events: rawChain as unknown as ReturnType<typeof makeChain> });
    const { getSessionDistractionCountForNow } = await import("../actions");

    const result = await getSessionDistractionCountForNow("session-1");

    expect(result).toBe(4);
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqSpy).toHaveBeenCalledWith("session_id", "session-1");
  });
});

// PERF-4: the write actions are lean; one deferred, data-free refresh covers every surface they feed.
describe("refreshDistractionViews", () => {
  beforeEach(() => revalidatePathMock.mockClear());

  it("revalidates Home, /deen, the domains-mode faith route, /review and /close (the close hosts the review), touching no data", async () => {
    const { refreshDistractionViews } = await import("../actions");
    await refreshDistractionViews();
    for (const path of ["/", "/deen", "/personal/[subdomain]", "/review", "/close"]) {
      expect(revalidatePathMock).toHaveBeenCalledWith(path);
    }
  });
});
