import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklyReviewView } from "../weekly-review-view";
import type { EfficiencyByClosedDay } from "@/lib/day-structure/closed-day";

function baseProps(efficiency: EfficiencyByClosedDay) {
  return {
    soFar: false,
    weekDayCount: 7,
    hours: { totalMinutes: 300, byKind: { deep_work: 200, deep_study: 100 } },
    recallMinutes: 40,
    efficiency,
    pareto: [],
    habitSummaries: [],
  };
}

// P3-09: one line under Hours, closed days get a real average, open days
// are an honest count (never a fabricated percent) -- see
// lib/day-structure/closed-day.ts's own header for why.
describe("WeeklyReviewView — P3-09 efficiency-by-closed-day line", () => {
  it("shows a real average for closed days and none for open days", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: 62, closedCount: 3, openCount: 2 })} />);
    expect(screen.getByText("Efficiency: 62% avg on 3 closed days · 2 open days (efficiency unavailable)")).toBeInTheDocument();
  });

  it("omits the open-days clause entirely when every engaged day was closed", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: 80, closedCount: 4, openCount: 0 })} />);
    expect(screen.getByText("Efficiency: 80% avg on 4 closed days")).toBeInTheDocument();
  });

  it("singular 'day' for exactly one closed day, exactly one open day", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: 55, closedCount: 1, openCount: 1 })} />);
    expect(screen.getByText("Efficiency: 55% avg on 1 closed day · 1 open day (efficiency unavailable)")).toBeInTheDocument();
  });

  it("shows only the open-day count, honestly, with no closed days at all", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: null, closedCount: 0, openCount: 2 })} />);
    expect(screen.getByText("Efficiency: 2 open days (efficiency unavailable), none closed")).toBeInTheDocument();
  });

  it("renders no efficiency line at all when the week has neither closed nor open days -- never a fabricated 0%", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: null, closedCount: 0, openCount: 0 })} />);
    expect(screen.queryByText(/Efficiency:/)).not.toBeInTheDocument();
  });
});
