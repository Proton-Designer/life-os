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

// 2026-08-13 is a Thursday in the week starting Sunday 2026-08-09.
const NOW = new Date("2026-08-13T18:00:00Z");

describe("saveWeeklyGoal", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    fromMock.mockClear();
  });

  it("upserts this week's goal keyed by (user_id, week_start_date, domain)", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: null, error: null }); // no prior week row
    fromImpl = (table) => (table === "profiles" ? profileChain : weeklyGoalsChain);
    const { saveWeeklyGoal } = await import("../actions");

    await saveWeeklyGoal("deen", "Read more Qur'an", ["Finish Juz 5"], 50, NOW);

    expect(weeklyGoalsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        week_start_date: "2026-08-09",
        domain: "deen",
        headline: "Read more Qur'an",
        milestones: ["Finish Juz 5"],
        quran_page_target: 50,
      }),
      expect.objectContaining({ onConflict: "user_id,week_start_date,domain" })
    );
  });

  it("locks last week's row if it exists and isn't already locked", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: { id: "prev-1", locked: false }, error: null });
    fromImpl = (table) => (table === "profiles" ? profileChain : weeklyGoalsChain);
    const { saveWeeklyGoal } = await import("../actions");

    await saveWeeklyGoal("business", "Close 3 deals", [], undefined, NOW);

    expect(weeklyGoalsChain.update).toHaveBeenCalledWith({ locked: true });
  });

  it("does not error when no prior week exists (first-ever week)", async () => {
    const profileChain = makeChain({ data: { timezone: "America/Chicago" }, error: null });
    const weeklyGoalsChain = makeChain({ data: null, error: null });
    fromImpl = (table) => (table === "profiles" ? profileChain : weeklyGoalsChain);
    const { saveWeeklyGoal } = await import("../actions");

    await expect(
      saveWeeklyGoal("deen", "First week goal", [], undefined, NOW)
    ).resolves.not.toThrow();
    expect(weeklyGoalsChain.update).not.toHaveBeenCalled();
  });
});
