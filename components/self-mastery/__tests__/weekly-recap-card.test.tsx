import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyRecapCard } from "../weekly-recap-card";
import type { UlmWeeklyRecap } from "@/lib/self-mastery/weekly-retention-recap";

function recap(overrides: Partial<UlmWeeklyRecap> = {}): UlmWeeklyRecap {
  return {
    weekStart: "2026-09-07",
    overallRetentionPct: 78,
    trend: "up",
    strongestBook: { title: "Atomic Habits" },
    weakestBook: { title: "Deep Work" },
    ...overrides,
  };
}

describe("WeeklyRecapCard (Phase 2 #P2-03)", () => {
  it("renders nothing when there's no recap yet -- a real, silent-absence state", () => {
    render(<WeeklyRecapCard recap={null} />);
    expect(screen.queryByTestId("weekly-recap-card")).not.toBeInTheDocument();
  });

  it("shows the overall retention percentage, rounded", () => {
    render(<WeeklyRecapCard recap={recap({ overallRetentionPct: 78.456 })} />);
    expect(screen.getByText("78%")).toBeInTheDocument();
  });

  it("shows strongest and weakest book titles", () => {
    render(<WeeklyRecapCard recap={recap()} />);
    expect(screen.getByText(/Strongest: Atomic Habits/)).toBeInTheDocument();
    expect(screen.getByText(/Weakest: Deep Work/)).toBeInTheDocument();
  });

  it("does not duplicate the weakest line when it's the SAME book as strongest (only one reviewed book)", () => {
    render(<WeeklyRecapCard recap={recap({ strongestBook: { title: "Only Book" }, weakestBook: { title: "Only Book" } })} />);
    expect(screen.getByText(/Strongest: Only Book/)).toBeInTheDocument();
    expect(screen.queryByText(/Weakest:/)).not.toBeInTheDocument();
  });

  it("shows neither strongest nor weakest line when nothing has been reviewed yet", () => {
    render(<WeeklyRecapCard recap={recap({ strongestBook: null, weakestBook: null })} />);
    expect(screen.queryByText(/Strongest:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Weakest:/)).not.toBeInTheDocument();
  });

  it("shows no trend pill for 'no_data' (first week ever) -- never a fabricated flat/up/down", () => {
    render(<WeeklyRecapCard recap={recap({ trend: "no_data" })} />);
    expect(screen.queryByText("Up")).not.toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
    expect(screen.queryByText("Flat")).not.toBeInTheDocument();
  });

  it.each([
    ["up", "Up"],
    ["down", "Down"],
    ["flat", "Flat"],
  ] as const)("shows a '%s' trend pill labeled '%s'", (trend, label) => {
    render(<WeeklyRecapCard recap={recap({ trend })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
