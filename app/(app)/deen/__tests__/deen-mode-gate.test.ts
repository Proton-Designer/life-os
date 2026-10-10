import { beforeEach, describe, expect, it, vi } from "vitest";

// Deen Mode OFF must REFUSE every deen Server Action (a Server Action is a
// public endpoint; hiding the button is not refusing) and must never touch
// the database -- OFF is a gate, not a delete (R4).
const fromMock = vi.fn(() => {
  throw new Error("DB touched");
});
const guard = vi.fn(async () => false);
const profileMock = vi.fn(async () => ({ timezone: "UTC", deen_mode: false }) as Record<string, unknown> | null);

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(async () => ({ supabase: { from: fromMock }, userId: "user-1" })),
  getProfile: profileMock,
  getAuthedUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/deen/deen-mode-guard", () => ({
  isDeenModeOnForRequest: guard,
  getRequestTimezone: vi.fn(async () => "UTC"),
  DEEN_MODE_OFF_MESSAGE: "Faith Mode is off",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("deen/actions.ts refuses when Faith Mode is off", () => {
  beforeEach(() => {
    fromMock.mockClear();
    guard.mockReset();
    guard.mockResolvedValue(false);
  });

  it("every exported action is a no-op (or throws the OFF message) and never queries", async () => {
    const actions = await import("../actions");
    const calls: Record<string, () => Promise<unknown>> = {
      markPrayer: () => actions.markPrayer("2026-08-10", "fajr", "on_time"),
      unmarkPrayer: () => actions.unmarkPrayer("2026-08-10", "fajr"),
      toggleAdhkar: () => actions.toggleAdhkar("2026-08-10", "morning"),
      logQuranSession: () => (actions.logQuranSession as (...a: unknown[]) => Promise<unknown>)("2026-08-10", 1, 1),
      adjustQadaBacklog: () => actions.adjustQadaBacklog(1),
      setTravelingMode: () => actions.setTravelingMode(true),
      logReflectionEntry: () => actions.logReflectionEntry(1),
      decrementReflectionEntry: () => actions.decrementReflectionEntry(1),
      toggleDeenHabitLog: () => actions.toggleDeenHabitLog("h1", "2026-08-10"),
      toggleSunnah: () => (actions.toggleSunnah as (...a: unknown[]) => Promise<unknown>)("2026-08-10", "fajr", "before"),
      setAdhkar: () => actions.setAdhkar("2026-08-10", "morning", true),
      setSunnah: () => (actions.setSunnah as (...a: unknown[]) => Promise<unknown>)("2026-08-10", "fajr", "before", true),
      setWeeklyFocus: () => actions.setWeeklyFocus("h1"),
      updateDeenHabit: () => actions.updateDeenHabit("h1", "n", null),
      archiveDeenHabit: () => actions.archiveDeenHabit("h1"),
      setDeenHabitStageOverride: () => actions.setDeenHabitStageOverride("h1", null),
      setDeenHabitCommittedDate: () => actions.setDeenHabitCommittedDate("h1", "2026-08-10"),
      setDeenHabitFrequency: () => actions.setDeenHabitFrequency("h1", { kind: "per_week", count: 3 }),
      setDeenHabitLogStatus: () => actions.setDeenHabitLogStatus("h1", "2026-08-10", true),
      refreshFaithPracticeViews: () => actions.refreshFaithPracticeViews(),
      getDeenHabitLogRange: () => actions.getDeenHabitLogRange("h1", "2026-08-01", "2026-08-10"),
    };
    // Guards against a new exported action silently escaping this test.
    const exported = Object.keys(actions).filter((k) => typeof (actions as Record<string, unknown>)[k] === "function");
    // refreshDeenViews (PERF-1) is a data-free revalidation, deliberately not gated.
    expect(exported.filter((k) => k !== "refreshDeenViews").sort()).toEqual([...Object.keys(calls), "createDeenHabit"].sort());

    for (const [name, call] of Object.entries(calls)) {
      const result = await call();
      // void actions resolve undefined; the one read resolves an empty list.
      expect(name === "getDeenHabitLogRange" ? result : result ?? null, name).toEqual(name === "getDeenHabitLogRange" ? [] : null);
    }
    await expect(actions.createDeenHabit("x")).rejects.toThrow("Faith Mode is off");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("positive control: with Faith Mode ON the same action reaches the database", async () => {
    guard.mockResolvedValue(true);
    const { archiveDeenHabit } = await import("../actions");
    await expect(archiveDeenHabit("h1")).rejects.toThrow("DB touched");
    expect(fromMock).toHaveBeenCalled();
  });
});

describe("salah-calendar-actions refuse when Faith Mode is off", () => {
  it("returns empty and never queries", async () => {
    fromMock.mockClear();
    profileMock.mockResolvedValue({ timezone: "UTC", deen_mode: false });
    const { getSalahMonthSummary, getSalahDayDetail } = await import("../salah-calendar-actions");
    expect(await getSalahMonthSummary(2026, 8)).toEqual([]);
    expect(await getSalahDayDetail("2026-08-10")).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("positive control: ON reaches the database", async () => {
    profileMock.mockResolvedValue({ timezone: "UTC", deen_mode: true });
    const { getSalahDayDetail } = await import("../salah-calendar-actions");
    await expect(getSalahDayDetail("2026-08-10")).rejects.toThrow("DB touched");
  });
});
