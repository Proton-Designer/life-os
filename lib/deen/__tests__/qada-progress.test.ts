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
  it("is positive at zero backlog — nothing owed, regardless of this window's activity", () => {
    expect(accentForQadaBacklog(0, 0, 0)).toBe("business");
    expect(accentForQadaBacklog(0, 3, 0)).toBe("business");
  });

  // Opus Lead review (2026-08-16): qada backlog is a long-term catch-up
  // project, not an alert — a binary any-backlog-means-warning rule pins
  // the card amber permanently and the tint stops carrying information.
  // Tint by direction over the window instead, using the same two counts
  // (caught up / newly missed) already computed for the card's caption.
  it("is positive when more was caught up than newly missed this window — falling behind less", () => {
    expect(accentForQadaBacklog(5, 3, 1)).toBe("business");
  });

  it("is neutral when catch-ups and new misses net to zero", () => {
    expect(accentForQadaBacklog(5, 2, 2)).toBe("neutral");
    expect(accentForQadaBacklog(5, 0, 0)).toBe("neutral");
  });

  it("is warning when more was newly missed than caught up — falling further behind", () => {
    expect(accentForQadaBacklog(5, 1, 3)).toBe("warning");
  });
});
