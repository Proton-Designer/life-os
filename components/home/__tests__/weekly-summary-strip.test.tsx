import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklySummaryStrip } from "../weekly-summary-strip";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

function snapshots(overrides: Partial<DomainSnapshots> = {}): DomainSnapshots {
  return {
    deen: { nextPrayer: null, prayerStatuses: [], quranWeekPages: 12, quranWeeklyTarget: null, habitFocusName: null, habitFocusStreak: 0, pulse: 0, qadaBacklogCount: 0 },
    business: { activeSession: null, killListDone: 0, killListTotal: 3, weeklyRatioDisplay: "3:1", pulse: 0 },
    fitness: { scheduledWorkoutName: null, workoutDone: false, weeklyConsistency: 0, workoutsThisWeek: 4, pulse: 0 },
    school: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 2, pulse: 0 },
    co_op: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 1, pulse: 0 },
    ...overrides,
  };
}

describe("WeeklySummaryStrip", () => {
  it("renders all 4 stat values in the mono tabular scale", () => {
    render(<WeeklySummaryStrip snapshots={snapshots()} />);
    expect(screen.getByText("3:1").className).toContain("font-mono");
    expect(screen.getByText("12").className).toContain("font-mono");
    expect(screen.getByText("4").className).toContain("font-mono");
    expect(screen.getByText("3").className).toContain("font-mono");
  });

  it("renders an icon chip for each stat", () => {
    const { container } = render(<WeeklySummaryStrip snapshots={snapshots()} />);
    expect(container.querySelectorAll("svg").length).toBe(4);
  });

  it("still sums school + co_op for tasks done, no new fetching", () => {
    render(<WeeklySummaryStrip snapshots={snapshots({ school: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 5, pulse: 0 }, co_op: { dueTodayCount: 0, nextDueTitle: null, completedThisWeek: 5, pulse: 0 } })} />);
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
