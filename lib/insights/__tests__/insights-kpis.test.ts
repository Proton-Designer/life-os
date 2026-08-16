import { describe, expect, it } from "vitest";
import { getInsightsKpis, type InsightsKpisDataSource } from "../insights-kpis";

function dataSourceWith(
  rows: { checkin_time: string; tag_type: string | null; answered: boolean }[]
): InsightsKpisDataSource {
  return { getAllCheckins: async () => rows };
}

const weekStart = "2026-08-09"; // Sunday
const previousWeekStart = "2026-08-02";

describe("getInsightsKpis", () => {
  it("computes this week's coverage as answered / total slots", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      dataSourceWith([
        { checkin_time: "2026-08-10T10:00:00Z", tag_type: "deen", answered: true },
        { checkin_time: "2026-08-10T12:00:00Z", tag_type: null, answered: false },
        { checkin_time: "2026-08-11T10:00:00Z", tag_type: "kill_list", answered: true },
      ])
    );
    expect(result.coveragePct).toBeCloseTo(66.7, 0);
    expect(result.answeredCount).toBe(2);
    expect(result.totalSlots).toBe(3);
  });

  it("picks the domain with the most answered check-ins this week, excluding noise/other_work", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      dataSourceWith([
        { checkin_time: "2026-08-10T10:00:00Z", tag_type: "kill_list", answered: true },
        { checkin_time: "2026-08-10T11:00:00Z", tag_type: "kill_list", answered: true },
        { checkin_time: "2026-08-10T12:00:00Z", tag_type: "deen", answered: true },
        { checkin_time: "2026-08-10T13:00:00Z", tag_type: "noise", answered: true },
        { checkin_time: "2026-08-10T14:00:00Z", tag_type: "noise", answered: true },
        { checkin_time: "2026-08-10T15:00:00Z", tag_type: "noise", answered: true },
      ])
    );
    expect(result.mostFocusedDomain).toBe("business");
  });

  it("returns null for most-focused domain when nothing real-domain was answered this week", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      dataSourceWith([{ checkin_time: "2026-08-10T10:00:00Z", tag_type: "noise", answered: true }])
    );
    expect(result.mostFocusedDomain).toBeNull();
  });

  it("computes noise share this week and its delta vs last week", async () => {
    const result = await getInsightsKpis(
      "user-1",
      weekStart,
      previousWeekStart,
      dataSourceWith([
        // Last week: 1 of 2 answered was noise (50%)
        { checkin_time: "2026-08-03T10:00:00Z", tag_type: "noise", answered: true },
        { checkin_time: "2026-08-03T11:00:00Z", tag_type: "deen", answered: true },
        // This week: 1 of 4 answered is noise (25%)
        { checkin_time: "2026-08-10T10:00:00Z", tag_type: "noise", answered: true },
        { checkin_time: "2026-08-10T11:00:00Z", tag_type: "deen", answered: true },
        { checkin_time: "2026-08-10T12:00:00Z", tag_type: "kill_list", answered: true },
        { checkin_time: "2026-08-10T13:00:00Z", tag_type: "kill_list", answered: true },
      ])
    );
    expect(result.noiseSharePct).toBeCloseTo(25, 0);
    expect(result.noiseShareDeltaPct).toBeCloseTo(-25, 0);
  });

  it("returns 0 coverage and 0 noise share, not NaN, when there's no data at all", async () => {
    const result = await getInsightsKpis("user-1", weekStart, previousWeekStart, dataSourceWith([]));
    expect(result.coveragePct).toBe(0);
    expect(result.noiseSharePct).toBe(0);
    expect(result.noiseShareDeltaPct).toBe(0);
    expect(result.mostFocusedDomain).toBeNull();
  });
});
