import { describe, it, expect } from "vitest";
import { decidePromotions } from "../promotion";

describe("decidePromotions", () => {
  it("denies a lesson with zero cards", () => {
    const result = decidePromotions([{ id: "a", cardCount: 0 }]);
    expect(result.promoted).toHaveLength(0);
    expect(result.denied).toEqual(["a"]);
  });

  it("promotes a lesson with one surviving card", () => {
    const result = decidePromotions([{ id: "a", cardCount: 1 }]);
    expect(result.promoted).toEqual([{ id: "a", rank: 0 }]);
    expect(result.denied).toHaveLength(0);
  });

  it("assigns dense ranks (no gaps) when a denial sits in the middle", () => {
    const result = decidePromotions([
      { id: "a", cardCount: 4 },
      { id: "b", cardCount: 0 }, // denied — must not consume a rank slot
      { id: "c", cardCount: 2 },
      { id: "d", cardCount: 0 }, // denied again
      { id: "e", cardCount: 1 },
    ]);
    expect(result.promoted).toEqual([
      { id: "a", rank: 0 },
      { id: "c", rank: 1 },
      { id: "e", rank: 2 },
    ]);
    expect(result.denied).toEqual(["b", "d"]);
  });

  it("denies everyone when every candidate has zero cards", () => {
    const result = decidePromotions([
      { id: "a", cardCount: 0 },
      { id: "b", cardCount: 0 },
    ]);
    expect(result.promoted).toHaveLength(0);
    expect(result.denied).toEqual(["a", "b"]);
  });

  it("promotes everyone with dense sequential ranks when nobody is denied", () => {
    const result = decidePromotions([
      { id: "a", cardCount: 3 },
      { id: "b", cardCount: 1 },
      { id: "c", cardCount: 2 },
    ]);
    expect(result.promoted).toEqual([
      { id: "a", rank: 0 },
      { id: "b", rank: 1 },
      { id: "c", rank: 2 },
    ]);
    expect(result.denied).toHaveLength(0);
  });

  it("returns empty results for an empty input", () => {
    const result = decidePromotions([]);
    expect(result.promoted).toHaveLength(0);
    expect(result.denied).toHaveLength(0);
  });
});
