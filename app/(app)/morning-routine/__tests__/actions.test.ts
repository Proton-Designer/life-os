import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = {
  create: vi.fn(async () => ({})),
  archive: vi.fn(async () => {}),
  check: vi.fn(async () => {}),
  uncheck: vi.fn(async () => {}),
  list: vi.fn(async () => [{ id: "i1", label: "Stretch", checked: false }]),
  setDone: vi.fn(async () => {}),
};
vi.mock("@/lib/morning-routine/actions-core", () => ({
  createMorningRoutineItemCore: (...a: unknown[]) => (coreMocks.create as (...x: unknown[]) => unknown)(...a),
  archiveMorningRoutineItemCore: (...a: unknown[]) => (coreMocks.archive as (...x: unknown[]) => unknown)(...a),
  checkMorningRoutineItemCore: (...a: unknown[]) => (coreMocks.check as (...x: unknown[]) => unknown)(...a),
  uncheckMorningRoutineItemCore: (...a: unknown[]) => (coreMocks.uncheck as (...x: unknown[]) => unknown)(...a),
  getMorningRoutineChecklistCore: (...a: unknown[]) => (coreMocks.list as (...x: unknown[]) => unknown)(...a),
  setLaunchStepDoneCore: (...a: unknown[]) => (coreMocks.setDone as (...x: unknown[]) => unknown)(...a),
}));
let enabledFeatures: string[] = [];
vi.mock("@/lib/opt-in-guard", () => ({
  isOptInFeatureOnForRequest: async (id: string) => enabledFeatures.includes(id),
  FEATURE_OFF_MESSAGE: "This feature is off.",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({ supabase: {}, userId: "u1" }),
  getProfile: async () => ({ timezone: "America/Chicago" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("../actions");

// RS-01: the morning routine is an opt-in feature, OFF by default for everyone. A Server Action
// is a public endpoint, so OFF must refuse and never touch the data (nothing is ever deleted).
describe("morning routine actions — opt-in gate", () => {
  beforeEach(() => {
    Object.values(coreMocks).forEach((m) => m.mockClear());
  });

  it("OFF: reads an empty checklist without querying; every write is refused and writes nothing", async () => {
    enabledFeatures = [];
    expect(await actions.getMyMorningRoutineChecklist()).toEqual([]);
    expect(coreMocks.list).not.toHaveBeenCalled();
    for (const result of [
      await actions.createMorningRoutineItem("Stretch"),
      await actions.archiveMorningRoutineItem("i1"),
      await actions.checkMorningRoutineItem("i1"),
      await actions.uncheckMorningRoutineItem("i1"),
      await actions.setLaunchStepDone("i1", true),
    ]) {
      expect(result).toEqual({ ok: false, message: "This feature is off." });
    }
    expect(coreMocks.create).not.toHaveBeenCalled();
    expect(coreMocks.archive).not.toHaveBeenCalled();
    expect(coreMocks.check).not.toHaveBeenCalled();
    expect(coreMocks.uncheck).not.toHaveBeenCalled();
    expect(coreMocks.setDone).not.toHaveBeenCalled();
  });

  it("ON: reads and writes go through", async () => {
    enabledFeatures = ["morning_routine"];
    expect(await actions.getMyMorningRoutineChecklist()).toHaveLength(1);
    // IA-P4a: create returns the new row so the card can show it at once.
    expect(await actions.createMorningRoutineItem("Stretch")).toEqual({ ok: true, item: {} });
    expect(await actions.setLaunchStepDone("i1", false)).toEqual({ ok: true });
    expect(coreMocks.setDone).toHaveBeenCalledWith({}, "u1", "i1", false, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(Date), "America/Chicago");
    expect(await actions.checkMorningRoutineItem("i1")).toEqual({ ok: true });
    expect(coreMocks.create).toHaveBeenCalledTimes(1);
    expect(coreMocks.check).toHaveBeenCalledTimes(1);
  });

  it("only the morning_routine id turns it on (sleep_plan does not)", async () => {
    enabledFeatures = ["sleep_plan"];
    expect(await actions.getMyMorningRoutineChecklist()).toEqual([]);
  });
});
