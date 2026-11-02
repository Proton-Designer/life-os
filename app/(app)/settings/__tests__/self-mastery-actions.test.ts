// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveCore, getCore, revalidateMock, setHomeCore } = vi.hoisted(() => ({ saveCore: vi.fn(), getCore: vi.fn(), revalidateMock: vi.fn(), setHomeCore: vi.fn() }));
vi.mock("@/lib/self-mastery/home-visibility-core", () => ({ setSelfMasteryOnHomeCore: setHomeCore, getSelfMasteryOnHomeCore: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: { tag: "sb" }, userId: "user-1" }) }));
vi.mock("@/lib/self-mastery/session-settings-core", () => ({ saveSelfMasterySettingsCore: saveCore, getSelfMasterySettingsCore: getCore }));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { getSelfMasterySettings, saveSelfMasterySettings, setSelfMasteryOnHome } from "../self-mastery-actions";

beforeEach(() => vi.clearAllMocks());

describe("Self-Mastery settings actions", () => {
  it("get reads for the signed-in user", async () => {
    getCore.mockResolvedValue({ dailyNewLimit: 5, sessionTargetMinutes: 8 });
    expect(await getSelfMasterySettings()).toEqual({ dailyNewLimit: 5, sessionTargetMinutes: 8 });
    expect(getCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1");
  });

  it("save validates, writes for the signed-in user (never a client-supplied id) and revalidates Home + Settings", async () => {
    saveCore.mockResolvedValue({});
    expect(await saveSelfMasterySettings({ dailyNewLimit: 10, sessionTargetMinutes: 12 })).toEqual({ ok: true });
    expect(saveCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1", { dailyNewLimit: 10, sessionTargetMinutes: 12 });
    expect(revalidateMock).toHaveBeenCalledWith("/");
    expect(revalidateMock).toHaveBeenCalledWith("/settings");
  });

  it("an invalid value is { ok:false, message } and never reaches the database", async () => {
    for (const bad of [{ dailyNewLimit: 51, sessionTargetMinutes: 8 }, { dailyNewLimit: 5, sessionTargetMinutes: 4 }, { dailyNewLimit: 2.5, sessionTargetMinutes: 8 }]) {
      const r = await saveSelfMasterySettings(bad);
      expect(r.ok).toBe(false);
    }
    expect(saveCore).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("a refused write is { ok:false, message } and revalidates nothing", async () => {
    saveCore.mockRejectedValue(new Error("No settings row."));
    expect(await saveSelfMasterySettings({ dailyNewLimit: 5, sessionTargetMinutes: 8 })).toEqual({ ok: false, message: "No settings row." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("setSelfMasteryOnHome", () => {
  it("writes for the signed-in user and revalidates Home + Settings", async () => {
    setHomeCore.mockResolvedValue(false);
    expect(await setSelfMasteryOnHome(false)).toEqual({ ok: true });
    expect(setHomeCore).toHaveBeenCalledWith({ tag: "sb" }, "user-1", false);
    expect(revalidateMock).toHaveBeenCalledWith("/");
    expect(revalidateMock).toHaveBeenCalledWith("/settings");
  });

  it("a non-boolean never reaches the database; a refused write is { ok:false } and revalidates nothing", async () => {
    expect((await setSelfMasteryOnHome("no" as unknown as boolean)).ok).toBe(false);
    expect(setHomeCore).not.toHaveBeenCalled();
    setHomeCore.mockRejectedValue(new Error("No settings row."));
    expect(await setSelfMasteryOnHome(true)).toEqual({ ok: false, message: "No settings row." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
