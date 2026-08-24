import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklyGoalsHeader } from "../weekly-goals-header";

describe("WeeklyGoalsHeader", () => {
  it("shows an explicit DEEN/BUSINESS label on each card, not just a color", () => {
    render(<WeeklyGoalsHeader deen={{ headline: "Finish Surah Kahf" }} business={{ headline: "Ship the landing page" }} />);
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toBeInTheDocument();
  });

  it("shows a distinct 'set this week's goal' affordance for an empty slot, per domain", () => {
    render(<WeeklyGoalsHeader deen={null} business={{ headline: "Ship the landing page" }} />);
    expect(screen.getByRole("link", { name: /Set this week's Deen goal/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Set this week's Business goal/ })).not.toBeInTheDocument();
  });

  it("renders both cards even when neither goal is set", () => {
    render(<WeeklyGoalsHeader deen={null} business={null} />);
    expect(screen.getByRole("link", { name: /Set this week's Deen goal/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set this week's Business goal/ })).toBeInTheDocument();
  });
});
