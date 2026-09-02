import { describe, expect, it } from "vitest";
import { assignRanks } from "../rank-assignment";

describe("rank assignment — the crown is rank 1, and ranks are the day's, not the task's", () => {
  it("the crowned item is rank 1", () => {
    const ranks = assignRanks({ starred: ["a", "b", "c"], crowned: "b" });
    expect(ranks.find((r) => r.id === "b")?.mitRank).toBe(1);
  });

  it("the other starred items take 2 and 3 in their selection order", () => {
    const ranks = assignRanks({ starred: ["a", "b", "c"], crowned: "b" });
    expect(ranks).toEqual([
      { id: "b", mitRank: 1 },
      { id: "a", mitRank: 2 },
      { id: "c", mitRank: 3 },
    ]);
  });

  it("selection order is preserved among the uncrowned — starring order is a real signal", () => {
    const ranks = assignRanks({ starred: ["c", "a", "b"], crowned: "b" });
    expect(ranks.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  /**
   * SPEC: "rank: 1|2|3|null where null is a real state ('dumped, not
   * starred')". An unstarred item is not rank 4 and not rank 0 — it has no
   * rank, and the column is nullable precisely so that can be expressed.
   */
  it("nothing starred yields no ranks at all, not zeroes", () => {
    expect(assignRanks({ starred: [], crowned: null })).toEqual([]);
  });

  /**
   * crown() already refuses an unstarred id, but assignRanks is a separate
   * entry point and a caller could hand it an inconsistent pair. Throwing beats
   * silently ranking something the user never starred — the write is what makes
   * it real, and a wrong write here is invisible afterwards.
   */
  it("refuses a crown that is not among the starred", () => {
    expect(() => assignRanks({ starred: ["a", "b"], crowned: "z" })).toThrow(/not starred/i);
  });

  /**
   * The database enforces one rank-1 per user per planned_date via
   * tasks_mit_rank_per_day_idx. This function must never PRODUCE a duplicate
   * rank, so the index is a backstop rather than the thing catching ordinary
   * bugs — an insert rejected at the index is a 500 to the user.
   */
  it("never emits a duplicate rank", () => {
    const ranks = assignRanks({ starred: ["a", "b", "c"], crowned: "c" });
    const seen = ranks.map((r) => r.mitRank);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("a single starred-and-crowned item is just rank 1", () => {
    expect(assignRanks({ starred: ["a"], crowned: "a" })).toEqual([{ id: "a", mitRank: 1 }]);
  });

  /**
   * Starred but not yet crowned is a legitimate mid-ceremony state. It must not
   * invent a crown by promoting the first starred item — crowning is a separate
   * act, and silently doing it for the user is exactly the collapse the SPEC
   * forbids.
   */
  it("starred with no crown yet ranks nothing — it does not promote the first star", () => {
    expect(assignRanks({ starred: ["a", "b"], crowned: null })).toEqual([]);
  });
});

/**
 * Found by reading my own implementation after the tests were green: a fourth
 * starred id would have produced `mitRank: 4`, which `tasks.mit_rank`'s CHECK
 * (1..3) rejects at write time — and the `as 2 | 3` cast would have carried the
 * lie all the way to the database. MAX_STARRED and `star()` prevent it upstream,
 * but this is a separate entry point, exactly as the crown check is.
 */
describe("rank assignment — the three-star cap holds at this entry point too", () => {
  it("refuses more than three starred ids rather than emitting rank 4", () => {
    expect(() => assignRanks({ starred: ["a", "b", "c", "d"], crowned: "a" })).toThrow(/at most three/i);
  });

  it("exactly three is fine", () => {
    expect(assignRanks({ starred: ["a", "b", "c"], crowned: "a" }).map((r) => r.mitRank)).toEqual([1, 2, 3]);
  });
});
