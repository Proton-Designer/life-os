import { beforeEach, describe, expect, it, vi } from "vitest";

const setUpDayCore = vi.fn();
vi.mock("@/lib/day-setup/actions-core", () => ({ setUpDayCore: (...a: unknown[]) => setUpDayCore(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: async () => ({ supabase: { tag: "client" }, userId: "u1" }) }));

const { setUpDay } = await import("../actions");

describe("setUpDay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the derived times and revalidates the whole layout (shell + Home read the feature flags)", async () => {
    setUpDayCore.mockResolvedValue({ plan: { bedtime: "23:00", windDownStart: "22:15", windDownMinutes: 45 }, stepsCreated: 2, featuresEnabled: ["sleep_plan"] });
    const res = await setUpDay({ wakeTime: "07:00", sleepNeedMinutes: 480, routineSteps: ["a", "b"] });
    expect(res).toEqual({ ok: true, bedtime: "23:00", windDownStart: "22:15", stepsCreated: 2 });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(setUpDayCore).toHaveBeenCalledWith({ tag: "client" }, "u1", expect.objectContaining({ wakeTime: "07:00" }));
  });

  it("a refusal's reason is RETURNED (never thrown) and nothing is revalidated", async () => {
    setUpDayCore.mockRejectedValue(new Error("Enter a valid wake time."));
    expect(await setUpDay({ wakeTime: "", sleepNeedMinutes: 480, routineSteps: [] })).toEqual({ ok: false, message: "Enter a valid wake time." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
