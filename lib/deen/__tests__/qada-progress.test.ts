import { describe, expect, it } from "vitest";
import { countRecentQadaCatchUps, accentForQadaBacklog } from "../qada-progress";

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

describe("accentForQadaBacklog", () => {
  it("is positive at zero backlog — nothing owed", () => {
    expect(accentForQadaBacklog(0)).toBe("business");
  });

  it("is warning once anything is owed", () => {
    // Binary, not thresholded — no "large backlog" number was specified,
    // and inventing one would be guessing at a figure nobody gave. Any
    // qada owed is worth flagging, conservatively, per overnight judgment
    // rules (documented in PROJECT_STATUS.md).
    expect(accentForQadaBacklog(1)).toBe("deen");
    expect(accentForQadaBacklog(12)).toBe("deen");
  });
});
