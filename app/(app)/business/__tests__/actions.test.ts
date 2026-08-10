import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "upsert", "update", "insert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Business actions", () => {
  beforeEach(() => {
    getUserMock.mockClear();
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

  it("toggleKillListItem flips completed from false to true, scoped to the authenticated user", async () => {
    const chain = makeChain({ data: { completed: false }, error: null });
    fromImpl = () => chain;
    const { toggleKillListItem } = await import("../actions");

    await toggleKillListItem("item-1");

    expect(chain.update).toHaveBeenCalledWith({ completed: true });
    expect(chain.eq).toHaveBeenCalledWith("id", "item-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
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
});
