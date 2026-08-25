import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "upsert", "update", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Business actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  it("setKillListItem upserts keyed by (user_id, date, position)", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { setKillListItem } = await import("../actions");

    await setKillListItem("2026-08-10", 0, "Ship the landing page");

    expect(fromMock).toHaveBeenCalledWith("kill_list_items");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        date: "2026-08-10",
        position: 0,
        text: "Ship the landing page",
      }),
      expect.objectContaining({ onConflict: "user_id,date,position" })
    );
  });

  it("toggleKillListItem flips completed from false to true and stamps completed_at, scoped to the authenticated user", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleKillListItem } = await import("../actions");

    await toggleKillListItem("item-1");

    expect(chain.update).toHaveBeenCalledWith({ completed: true, completed_at: expect.any(String) });
    expect(chain.eq).toHaveBeenCalledWith("id", "item-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("toggleKillListItem flips completed from true back to false and clears completed_at", async () => {
    const chain = makeChain({ data: { completed: true }, error: null });
    fromImpl = () => chain;
    const { toggleKillListItem } = await import("../actions");

    await toggleKillListItem("item-1");

    expect(chain.update).toHaveBeenCalledWith({ completed: false, completed_at: null });
  });

  it("toggleKillListItem throws (rather than silently no-op'ing) when the item doesn't exist or isn't the user's", async () => {
    const chain = makeChain({ data: null, error: null });
    fromImpl = () => chain;
    const { toggleKillListItem } = await import("../actions");

    await expect(toggleKillListItem("not-mine")).rejects.toThrow();
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("saveBusinessWeeklyGoal upserts weekly_goals scoped to domain 'business'", async () => {
    const chain = makeChain();
    fromImpl = () => chain;
    const { saveBusinessWeeklyGoal } = await import("../actions");

    await saveBusinessWeeklyGoal("2026-08-09", "Close 3 deals", ["Call leads", "Send proposals"]);

    expect(fromMock).toHaveBeenCalledWith("weekly_goals");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        week_start_date: "2026-08-09",
        domain: "business",
        headline: "Close 3 deals",
        milestones: ["Call leads", "Send proposals"],
      }),
      expect.objectContaining({ onConflict: "user_id,week_start_date,domain" })
    );
  });

  it("startWorkSession throws when an active session already exists for this user, regardless of the requested kind", async () => {
    const chain = makeChain({
      data: { id: "existing-session" },
      error: null,
    });
    fromImpl = () => chain;
    const { startWorkSession } = await import("../actions");

    await expect(startWorkSession("deep_study")).rejects.toThrow();
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("startWorkSession inserts a new work_sessions row with the requested kind and returns it when no active session exists", async () => {
    let call = 0;
    const chain = makeChain();
    // First maybeSingle() call (the active-session check) resolves null;
    // the insert().select().single() call resolves the new row.
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    chain.single = vi.fn(async () => {
      call++;
      return { data: { id: "new-session", started_at: "2026-08-15T14:00:00.000Z" }, error: null };
    });
    fromImpl = () => chain;
    const { startWorkSession } = await import("../actions");

    const result = await startWorkSession("deep_study");

    expect(fromMock).toHaveBeenCalledWith("work_sessions");
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", kind: "deep_study" }));
    expect(result).toEqual({ id: "new-session", startedAt: "2026-08-15T14:00:00.000Z" });
    expect(call).toBe(1);
  });

  it("endWorkSession throws (rather than silently no-op'ing) when the session doesn't exist or isn't the user's", async () => {
    const chain = makeChain({ data: null, error: null });
    fromImpl = () => chain;
    const { endWorkSession } = await import("../actions");

    await expect(endWorkSession("not-mine")).rejects.toThrow();
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("endWorkSession sets ended_at, scoped to the session id and the authenticated user", async () => {
    const chain = makeChain({ data: { id: "session-1" }, error: null });
    fromImpl = () => chain;
    const { endWorkSession } = await import("../actions");

    await endWorkSession("session-1");

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ ended_at: expect.any(String) })
    );
    expect(chain.eq).toHaveBeenCalledWith("id", "session-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
