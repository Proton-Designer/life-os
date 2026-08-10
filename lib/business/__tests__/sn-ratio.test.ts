import { describe, expect, it } from "vitest";
import { getWeeklySignalNoiseRatio, type SnDataSource } from "../sn-ratio";

function dataSourceWith(checkins: { tag_type: string; answered: boolean }[]): SnDataSource {
  return { getCheckins: async () => checkins };
}

describe("getWeeklySignalNoiseRatio", () => {
  it("computes a normal ratio, excluding 'other_work' from both counts", async () => {
    const checkins = [
      ...Array(8).fill({ tag_type: "kill_list", answered: true }),
      ...Array(2).fill({ tag_type: "noise", answered: true }),
      ...Array(3).fill({ tag_type: "other_work", answered: true }),
    ];
    const result = await getWeeklySignalNoiseRatio(
      "user-1",
      new Date("2026-08-09T00:00:00Z"),
      dataSourceWith(checkins)
    );

    expect(result.signal).toBe(8);
    expect(result.noise).toBe(2);
    expect(result.display).toBe("4.0 : 1");
  });

  it("shows 'All Signal' when noise is zero", async () => {
    const checkins = Array(5).fill({ tag_type: "kill_list", answered: true });
    const result = await getWeeklySignalNoiseRatio(
      "user-1",
      new Date("2026-08-09T00:00:00Z"),
      dataSourceWith(checkins)
    );

    expect(result.display).toBe("All Signal");
  });

  it("shows 'No data' when there are zero check-ins all week", async () => {
    const result = await getWeeklySignalNoiseRatio(
      "user-1",
      new Date("2026-08-09T00:00:00Z"),
      dataSourceWith([])
    );

    expect(result.display).toBe("No data");
  });

  it("excludes unanswered (missed) check-ins from both signal and noise", async () => {
    const checkins = [
      { tag_type: "kill_list", answered: true },
      { tag_type: "noise", answered: false },
    ];
    const result = await getWeeklySignalNoiseRatio(
      "user-1",
      new Date("2026-08-09T00:00:00Z"),
      dataSourceWith(checkins)
    );

    expect(result.signal).toBe(1);
    expect(result.noise).toBe(0);
    expect(result.display).toBe("All Signal");
  });
});
