import { beforeEach, describe, expect, it, vi } from "vitest";

const updateCore = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/morning-routine/step-edit-core", () => ({ updateLaunchStepCore: (...a: unknown[]) => updateCore(...a) }));
vi.mock("@/lib/morning-routine/actions-core", () => ({}));
let enabled: string[] = [];
vi.mock("@/lib/opt-in-guard", () => ({
  isOptInFeatureOnForRequest: async (id: string) => enabled.includes(id),
  FEATURE_OFF_MESSAGE: "This feature is off.",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({ supabase: { s: 1 }, userId: "u1" }),
  getProfile: async () => ({ timezone: "America/Chicago" }),
}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const { updateLaunchStep } = await import("../actions");

describe("updateLaunchStep (IA-P4b)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("OFF: refuses and writes nothing", async () => {
    enabled = [];
    expect(await updateLaunchStep("s1", { label: "x" })).toEqual({ ok: false, message: "This feature is off." });
    expect(updateCore).not.toHaveBeenCalled();
  });

  it("ON: calls the core for the signed-in user and revalidates Home", async () => {
    enabled = ["morning_routine"];
    expect(await updateLaunchStep("s1", { label: "yoga" })).toEqual({ ok: true });
    expect(updateCore).toHaveBeenCalledWith({ s: 1 }, "u1", "s1", { label: "yoga" });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("surfaces a core rejection as a message (no throw)", async () => {
    enabled = ["morning_routine"];
    updateCore.mockRejectedValueOnce(new Error("That step no longer exists."));
    expect(await updateLaunchStep("s1", { label: "x" })).toEqual({ ok: false, message: "That step no longer exists." });
  });
});
