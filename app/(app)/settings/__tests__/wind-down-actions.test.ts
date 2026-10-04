import { beforeEach, describe, expect, it, vi } from "vitest";

let optIn = true;
const saveCore = vi.fn(async () => ({ bedtime: "23:00", windDownStart: "22:15", windDownMinutes: 45 }));
const getCore = vi.fn(async () => ({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45, plan: null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: {}, userId: "u1" }) }));
vi.mock("@/lib/opt-in-guard", () => ({ isOptInFeatureOnForRequest: async () => optIn, FEATURE_OFF_MESSAGE: "off" }));
vi.mock("@/lib/rhythm/wind-down-core", () => ({ saveWindDownPlanCore: (...a: unknown[]) => (saveCore as (...x: unknown[]) => unknown)(...a), getWindDownSettingsCore: () => getCore() }));

import { getWindDownSettings, saveWindDownPlan } from "../wind-down-actions";

describe("wind-down actions — sleep_plan opt-in gate", () => {
  beforeEach(() => {
    optIn = true;
    vi.clearAllMocks();
  });
  it("ON: saves and reads", async () => {
    expect(await saveWindDownPlan({ wakeTime: "07:00", sleepNeedMinutes: 480 })).toEqual({ ok: true, bedtime: "23:00", windDownStart: "22:15" });
    expect(await getWindDownSettings()).not.toBeNull();
  });
  it("OFF: refuses the write and reads nothing; stored data is untouched", async () => {
    optIn = false;
    expect(await saveWindDownPlan({ wakeTime: "07:00", sleepNeedMinutes: 480 })).toEqual({ ok: false, message: "off" });
    expect(await getWindDownSettings()).toBeNull();
    expect(saveCore).not.toHaveBeenCalled();
    expect(getCore).not.toHaveBeenCalled();
  });
  it("relays a validation/db error as a message", async () => {
    saveCore.mockRejectedValueOnce(new Error("Sleep need must be between 6 and 10 hours."));
    expect(await saveWindDownPlan({ wakeTime: "07:00", sleepNeedMinutes: 100 })).toEqual({ ok: false, message: "Sleep need must be between 6 and 10 hours." });
  });
});
