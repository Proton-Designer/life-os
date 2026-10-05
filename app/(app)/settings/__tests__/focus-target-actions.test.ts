// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveCore, getCore, revalidateMock } = vi.hoisted(() => ({ saveCore: vi.fn(), getCore: vi.fn(), revalidateMock: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: { tag: "sb" }, userId: "user-1" }) }));
vi.mock("@/lib/focus/target-core", () => ({ saveFocusTargetsCore: saveCore, getFocusTargetSettingsCore: getCore }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { getFocusTargetSettings, saveFocusTargets } from "../focus-target-actions";

beforeEach(() => vi.clearAllMocks());

describe("focus target actions", () => {
  it("get reads for the signed-in user", async () => {
    getCore.mockResolvedValue({ dailyMinutes: 300, weekendMinutes: null });
    expect(await getFocusTargetSettings()).toEqual({ dailyMinutes: 300, weekendMinutes: null });
    expect(getCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1");
  });
  it("save writes for the signed-in user and revalidates Home + Settings", async () => {
    saveCore.mockResolvedValue({});
    expect(await saveFocusTargets({ dailyMinutes: 300, weekendMinutes: 120 })).toEqual({ ok: true });
    expect(saveCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1", { dailyMinutes: 300, weekendMinutes: 120 });
    expect(revalidateMock).toHaveBeenCalledWith("/");
    expect(revalidateMock).toHaveBeenCalledWith("/settings");
  });
  it("a refused save is { ok:false, message } and revalidates nothing", async () => {
    saveCore.mockRejectedValue(new Error("Daily focus target must be a whole number"));
    expect(await saveFocusTargets({ dailyMinutes: 5, weekendMinutes: null })).toEqual({ ok: false, message: "Daily focus target must be a whole number" });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
