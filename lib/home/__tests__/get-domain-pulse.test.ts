import { describe, expect, it } from "vitest";
import { getDomainPulse, type PulseDataSource } from "../get-domain-pulse";

function emptyDataSource(overrides: Partial<PulseDataSource> = {}): PulseDataSource {
  return {
    getPrayers: async () => [],
    getKillListItems: async () => [],
    getTasks: async () => [],
    getHabits: async () => [],
    ...overrides,
  };
}

describe("getDomainPulse", () => {
  it("computes Deen's fraction from prayers only (5 trackables/day)", async () => {
    const dataSource = emptyDataSource({
      getPrayers: async () => [
        { prayer_name: "fajr", status: "on_time" },
        { prayer_name: "dhuhr", status: "on_time" },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    // 2 done out of 5 trackables (5 prayers — adhkar dropped from the UI,
    // see the Home/Deen/Business overhaul).
    expect(pulse.deen).toBeCloseTo(2 / 5);
  });

  it("returns 0 for a domain with zero trackables set today rather than dividing by zero", async () => {
    const pulse = await getDomainPulse("user-1", "2026-08-10", emptyDataSource());

    expect(pulse.business).toBe(0);
    expect(Number.isNaN(pulse.business)).toBe(false);
  });

  it("computes Business's fraction from kill list completion", async () => {
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { completed: true },
        { completed: true },
        { completed: false },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    expect(pulse.business).toBeCloseTo(2 / 3);
  });

  it("folds Co-op tasks into the School fraction", async () => {
    const dataSource = emptyDataSource({
      getTasks: async () => [
        { domain: "school", completed: true },
        { domain: "co_op", completed: false },
      ],
    });

    const pulse = await getDomainPulse("user-1", "2026-08-10", dataSource);

    expect(pulse.school).toBeCloseTo(1 / 2);
  });
});
