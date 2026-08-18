import { describe, expect, it } from "vitest";
import { buildQadaBacklog, totalQadaOwed } from "../qada-backlog";
import type { ResolvedDayStatuses } from "../prayer-status";

function day(overrides: Partial<ResolvedDayStatuses>): ResolvedDayStatuses {
  return {
    fajr: "on_time",
    dhuhr: "on_time",
    asr: "on_time",
    maghrib: "on_time",
    isha: "on_time",
    ...overrides,
  };
}

describe("buildQadaBacklog", () => {
  it("returns an empty backlog when nothing is missed", () => {
    const backlog = buildQadaBacklog({
      "2026-08-10": day({}),
    });
    expect(backlog.items).toEqual([]);
    expect(backlog.derivedCount).toBe(0);
  });

  it("collects only missed prayers, ignoring on_time/qada/pending/upcoming", () => {
    const backlog = buildQadaBacklog({
      "2026-08-10": day({ fajr: "missed", dhuhr: "pending", asr: "upcoming", maghrib: "qada" }),
    });
    expect(backlog.items).toEqual([{ date: "2026-08-10", prayer: "fajr" }]);
    expect(backlog.derivedCount).toBe(1);
  });

  it("collects missed prayers across multiple dates, most recent date first", () => {
    const backlog = buildQadaBacklog({
      "2026-08-08": day({ fajr: "missed" }),
      "2026-08-10": day({ isha: "missed" }),
      "2026-08-09": day({ asr: "missed" }),
    });
    expect(backlog.items.map((i) => i.date)).toEqual(["2026-08-10", "2026-08-09", "2026-08-08"]);
  });

  it("orders same-date misses in Fajr..Isha order", () => {
    const backlog = buildQadaBacklog({
      "2026-08-10": day({ isha: "missed", fajr: "missed", asr: "missed" }),
    });
    expect(backlog.items.map((i) => i.prayer)).toEqual(["fajr", "asr", "isha"]);
  });

  it("counts every missed (date, prayer) pair, not just distinct dates", () => {
    const backlog = buildQadaBacklog({
      "2026-08-10": day({ fajr: "missed", isha: "missed" }),
      "2026-08-11": day({ fajr: "missed" }),
    });
    expect(backlog.derivedCount).toBe(3);
  });
});

describe("totalQadaOwed", () => {
  it("sums legacy pre-app debt and the derived backlog count", () => {
    expect(totalQadaOwed(4, 3)).toBe(7);
  });

  it("is just the legacy count when nothing is derived", () => {
    expect(totalQadaOwed(4, 0)).toBe(4);
  });
});
