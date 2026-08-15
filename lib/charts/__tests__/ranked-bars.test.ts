import { describe, expect, it } from "vitest";
import { rankBars } from "../ranked-bars";

describe("rankBars", () => {
  it("sorts descending by value", () => {
    const ranked = rankBars([
      { label: "Fitness", value: 12 },
      { label: "Deen", value: 42 },
      { label: "Business", value: 30 },
    ]);
    expect(ranked.map((b) => b.label)).toEqual(["Deen", "Business", "Fitness"]);
  });

  it("scales pct relative to the largest value, so the top bar is always 100%", () => {
    const ranked = rankBars([
      { label: "Deen", value: 42 },
      { label: "Fitness", value: 21 },
    ]);
    expect(ranked[0].pct).toBe(100);
    expect(ranked[1].pct).toBe(50);
  });

  it("does not mutate the input array", () => {
    const input = [{ label: "B", value: 1 }, { label: "A", value: 2 }];
    rankBars(input);
    expect(input[0].label).toBe("B");
  });

  it("handles an all-zero data set without dividing by zero", () => {
    const ranked = rankBars([{ label: "A", value: 0 }, { label: "B", value: 0 }]);
    expect(ranked.every((b) => b.pct === 0)).toBe(true);
  });

  it("returns an empty array for empty input", () => {
    expect(rankBars([])).toEqual([]);
  });
});
