import { describe, expect, it } from "vitest";
import { countRecentQadaCatchUps } from "../qada-progress";

describe("countRecentQadaCatchUps", () => {
  it("counts prayers logged as qada within the given window", () => {
    const count = countRecentQadaCatchUps([
      { date: "2026-08-14", status: "qada" },
      { date: "2026-08-14", status: "on_time" },
      { date: "2026-08-13", status: "qada" },
      { date: "2026-08-12", status: "missed" },
    ]);
    expect(count).toBe(2);
  });

  it("returns 0 when nothing was caught up", () => {
    expect(countRecentQadaCatchUps([{ date: "2026-08-14", status: "on_time" }])).toBe(0);
  });

  it("returns 0 for an empty history", () => {
    expect(countRecentQadaCatchUps([])).toBe(0);
  });
});
