import { describe, expect, it } from "vitest";
import { getFocusMap, type FocusMapDataSource } from "../focus-map";

function dataSourceWith(checkins: { tag_type: string | null; answered: boolean }[]): FocusMapDataSource {
  return { getCheckins: async () => checkins };
}

describe("getFocusMap", () => {
  it("segments sum to ~100% across all answered check-ins, grouped by domain", async () => {
    const checkins = [
      { tag_type: "deen", answered: true },
      { tag_type: "kill_list", answered: true },
      { tag_type: "kill_list", answered: true },
      { tag_type: "workout", answered: true },
      { tag_type: "school", answered: true },
      { tag_type: "co_op", answered: true },
      { tag_type: "noise", answered: true },
      { tag_type: "other_work", answered: true },
      { tag_type: null, answered: false }, // missed — excluded entirely
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(checkins));

    const totalPct = result.segments.reduce((sum, s) => sum + s.pct, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it("maps kill_list->business, workout->fitness, school/co_op->school_co_op", async () => {
    const checkins = [
      { tag_type: "kill_list", answered: true },
      { tag_type: "workout", answered: true },
      { tag_type: "school", answered: true },
      { tag_type: "co_op", answered: true },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(checkins));
    const domains = result.segments.map((s) => s.domain).sort();

    expect(domains).toEqual(["business", "fitness", "school_co_op"].sort());
    const schoolCoOp = result.segments.find((s) => s.domain === "school_co_op");
    expect(schoolCoOp?.pct).toBeCloseTo(50, 0); // 2 of 4 answered check-ins
  });

  it("includes other_work as its own Focus Map segment", async () => {
    const checkins = [
      { tag_type: "kill_list", answered: true },
      { tag_type: "other_work", answered: true },
      { tag_type: "other_work", answered: true },
    ];

    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(checkins));

    const otherWorkSegment = result.segments.find((s) => s.domain === "other_work");
    expect(otherWorkSegment).toBeDefined();
    expect(otherWorkSegment?.pct).toBeCloseTo(66.7, 0);
  });

  it("returns raw counts alongside pct, for chart forms that scale by value (ranked bars)", async () => {
    const checkins = [
      { tag_type: "kill_list", answered: true },
      { tag_type: "kill_list", answered: true },
      { tag_type: "noise", answered: true },
    ];
    const result = await getFocusMap("user-1", "week", new Date("2026-08-09T00:00:00Z"), dataSourceWith(checkins));
    const business = result.segments.find((s) => s.domain === "business");
    expect(business?.count).toBe(2);
  });
});
