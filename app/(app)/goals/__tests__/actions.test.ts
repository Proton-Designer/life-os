import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePathMock(path) }));

const requireUserMock = vi.fn();
const getProfileMock = vi.fn(async () => ({ timezone: "America/Chicago", deen_mode: false }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: () => requireUserMock(), getProfile: () => getProfileMock() }));
const loadBoardMock = vi.fn(async (..._a: unknown[]) => ({ deenMode: false, reservedRanks: [], monthStart: "2026-10-01", todayStr: "2026-10-05", goals: [], milestones: [] }));
vi.mock("@/lib/goals/board-data", () => ({ loadGoalBoardData: (...a: unknown[]) => loadBoardMock(...a) }));

const createGoalMock = vi.fn();
const completeGoalMock = vi.fn();
const dropGoalMock = vi.fn();
const addMilestoneMock = vi.fn();
const completeMilestoneMock = vi.fn();
const reopenMilestoneMock = vi.fn();
vi.mock("@/lib/goals/actions-core", () => ({
  createGoal: (...args: unknown[]) => createGoalMock(...args),
  completeGoal: (...args: unknown[]) => completeGoalMock(...args),
  dropGoal: (...args: unknown[]) => dropGoalMock(...args),
  addMilestone: (...args: unknown[]) => addMilestoneMock(...args),
  completeMilestone: (...args: unknown[]) => completeMilestoneMock(...args),
  reopenMilestone: (...args: unknown[]) => reopenMilestoneMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ supabase: { fake: true }, userId: "user-1" });
});

describe("goal actions (#43/#44) — 'use server' wrappers over lib/goals/actions-core", () => {
  it("createGoalAction rejects a blank title without ever calling the DB", async () => {
    const { createGoalAction } = await import("../actions");
    const res = await createGoalAction({ monthStart: "2026-09-01", title: "   ", reason: "matters", rank: 1 });
    expect(res).toEqual({ error: "Give this goal a title." });
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("createGoalAction rejects a blank reason without ever calling the DB", async () => {
    const { createGoalAction } = await import("../actions");
    const res = await createGoalAction({ monthStart: "2026-09-01", title: "Ship it", reason: "  ", rank: 1 });
    expect(res).toEqual({ error: "Say why this goal matters — the reason is required." });
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("createGoalAction trims title/reason, passes rank/domain through, and revalidates /goals and /business", async () => {
    createGoalMock.mockResolvedValue({ id: "g1" });
    const { createGoalAction } = await import("../actions");
    const res = await createGoalAction({
      monthStart: "2026-09-01",
      title: "  Ship it  ",
      reason: " because ",
      rank: 3,
      domain: "business",
    });
    expect(res).toEqual({ ok: true });
    expect(createGoalMock).toHaveBeenCalledWith(
      { fake: true },
      "user-1",
      { monthStart: "2026-09-01", title: "Ship it", reason: "because", rank: 3, domain: "business" }
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/goals");
    expect(revalidatePathMock).toHaveBeenCalledWith("/business");
  });

  it("createGoalAction maps a rank-ceiling unique-violation (23505) to an honest message, not a raw Postgres string", async () => {
    createGoalMock.mockRejectedValue({ code: "23505", message: "duplicate key value violates unique constraint" });
    const { createGoalAction } = await import("../actions");
    const res = await createGoalAction({ monthStart: "2026-09-01", title: "Ship it", reason: "because", rank: 1 });
    expect(res).toEqual({
      error:
        "That rank is already taken by another active goal this month. Your 5 active goals are full — complete or drop one first.",
    });
  });

  it("setGoalStatusAction('done') calls completeGoal and revalidates", async () => {
    const { setGoalStatusAction } = await import("../actions");
    const res = await setGoalStatusAction("g1", "done");
    expect(res).toEqual({ ok: true });
    expect(completeGoalMock).toHaveBeenCalledWith({ fake: true }, "user-1", "g1");
    expect(dropGoalMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/goals");
  });

  it("setGoalStatusAction('dropped') calls dropGoal, not completeGoal", async () => {
    const { setGoalStatusAction } = await import("../actions");
    const res = await setGoalStatusAction("g1", "dropped");
    expect(res).toEqual({ ok: true });
    expect(dropGoalMock).toHaveBeenCalledWith({ fake: true }, "user-1", "g1");
    expect(completeGoalMock).not.toHaveBeenCalled();
  });

  it("addMilestoneAction rejects a blank title", async () => {
    const { addMilestoneAction } = await import("../actions");
    const res = await addMilestoneAction({ goalId: "g1", monthStart: "2026-09-01", title: "  " });
    expect(res).toEqual({ error: "Give the milestone a title." });
    expect(addMilestoneMock).not.toHaveBeenCalled();
  });

  it("addMilestoneAction maps the one-per-goal-per-month unique violation to an honest message", async () => {
    addMilestoneMock.mockRejectedValue({ code: "23505" });
    const { addMilestoneAction } = await import("../actions");
    const res = await addMilestoneAction({ goalId: "g1", monthStart: "2026-09-01", title: "Ship it" });
    expect(res).toEqual({ error: "This goal already has a milestone for this month." });
  });

  it("setMilestoneDoneAction(true) completes, (false) reopens", async () => {
    const { setMilestoneDoneAction } = await import("../actions");
    await setMilestoneDoneAction("m1", true);
    expect(completeMilestoneMock).toHaveBeenCalledWith({ fake: true }, "user-1", "m1");
    await setMilestoneDoneAction("m1", false);
    expect(reopenMilestoneMock).toHaveBeenCalledWith({ fake: true }, "user-1", "m1");
  });
});

// IA-P3b: Home's Goals sheet reads through ONE lean action, the same loader /week step 2 uses.
describe("getGoalsSheetData", () => {
  it("loads the board for the signed-in user with their profile, writing nothing", async () => {
    const { getGoalsSheetData } = await import("../actions");
    const data = await getGoalsSheetData();
    expect(loadBoardMock).toHaveBeenCalledWith({ fake: true }, "user-1", { timezone: "America/Chicago", deen_mode: false });
    expect(data.monthStart).toBe("2026-10-01");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
