import { describe, expect, it, vi } from "vitest";

// WORK-W1 review F1: Business writers must refresh the Work-tab page that serves the Business screen.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }) } })),
}));
vi.mock("@/lib/business/actions-core", () => ({
  setKillListItemCore: vi.fn(), toggleKillListItemCore: vi.fn(), setKillListItemCompletedCore: vi.fn(),
  saveBusinessWeeklyGoalCore: vi.fn(), startWorkSessionCore: vi.fn(), endWorkSessionCore: vi.fn(),
  toggleSessionObjectiveCore: vi.fn(), setSessionObjectiveCompletedCore: vi.fn(),
}));

const TAB = ["/work/[subdomain]", "page"];

describe("Business writers revalidate the tab route", () => {
  it("refreshBusinessViews, setKillListItem and saveBusinessWeeklyGoal all hit /business AND the work-tab page", async () => {
    const actions = await import("../actions");
    for (const run of [
      () => actions.refreshBusinessViews(),
      () => actions.setKillListItem("2026-10-05", 0, "x"),
      () => actions.saveBusinessWeeklyGoal("2026-10-05", "g", []),
    ]) {
      revalidatePath.mockClear();
      await run();
      expect(revalidatePath).toHaveBeenCalledWith("/business");
      expect(revalidatePath).toHaveBeenCalledWith(...TAB);
    }
  });
  it("positive control: a hot tap (setKillListItemCompleted) revalidates nothing -- the check can see 'no call'", async () => {
    const { setKillListItemCompleted } = await import("../actions");
    revalidatePath.mockClear();
    await setKillListItemCompleted("id", true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
