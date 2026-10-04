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

  // GAP-03, second half (ENG3's live-verify on c7beb30): closed-day.ts's own
  // count/average split (fixed in f1e7075) was never carried into this view
  // -- the old closedClause was gated on closedAvgPercent !== null alone, so
  // a real close with no usable average (closedCount=1, closedAvgPercent=
  // null) rendered NO efficiency line at all, same invisible-close symptom
  // moved from the data layer to the view layer.
  it("shows the closed-day count even when no usable average exists for it -- a close must never render as if it never happened", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: null, closedCount: 1, openCount: 0 })} />);
    expect(screen.getByText("Efficiency: 1 closed day, efficiency unavailable")).toBeInTheDocument();
  });

  it("plural closed-day count with no usable average", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: null, closedCount: 2, openCount: 0 })} />);
    expect(screen.getByText("Efficiency: 2 closed days, efficiency unavailable")).toBeInTheDocument();
  });

  it("combines a no-average closed count with an open-day count", () => {
    render(<WeeklyReviewView {...baseProps({ closedAvgPercent: null, closedCount: 1, openCount: 1 })} />);
    expect(screen.getByText("Efficiency: 1 closed day, efficiency unavailable · 1 open day (efficiency unavailable)")).toBeInTheDocument();
  });
});

// IA-P3a: the switch now lives on the Insights Week tab (and is hidden on /week).
describe("WeeklyReviewView — view switch (IA-P3a)", () => {
  const eff = { closedAvgPercent: 50, closedCount: 1, openCount: 0 };

  it("points at the Insights Week tab by default, never the retired /weekly-review", () => {
    render(<WeeklyReviewView {...baseProps(eff)} />);
    expect(screen.getByRole("link", { name: "Last completed week" })).toHaveAttribute("href", "/insights?tab=week");
    expect(screen.getByRole("link", { name: "This week so far" })).toHaveAttribute("href", "/insights?tab=week&view=so-far");
  });

  it("is hidden on /week, where the reset always reviews the completed week", () => {
    render(<WeeklyReviewView {...baseProps(eff)} showViewSwitch={false} />);
    expect(screen.queryByRole("link", { name: "This week so far" })).toBeNull();
  });

  it("the 'start a habit' link goes to the reset's habits step", () => {
    render(<WeeklyReviewView {...baseProps(eff)} />);
    expect(screen.getByRole("link", { name: "Start one" })).toHaveAttribute("href", "/week#habits");
  });
});
