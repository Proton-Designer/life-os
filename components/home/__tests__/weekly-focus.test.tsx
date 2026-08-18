import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeeklyFocus } from "../weekly-focus";

describe("WeeklyFocus", () => {
  it("shows the Deen headline and milestones when a Deen goal exists", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: ["Read after Fajr", "Review with tutor"], quranPages: 12, quranTarget: 20 }}
        business={null}
        showPlanningNudge={false}
      />
    );
    expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
    expect(screen.getByText("Read after Fajr")).toBeInTheDocument();
    expect(screen.getByText("Review with tutor")).toBeInTheDocument();
  });

  it("shows the Qur'an progress line only when a quranTarget is set", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 12, quranTarget: 20 }}
        business={null}
        showPlanningNudge={false}
      />
    );
    expect(screen.getByText("Qur'an 12/20 pages")).toBeInTheDocument();
  });

  it("omits the Qur'an progress line when quranTarget is null", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 12, quranTarget: null }}
        business={null}
        showPlanningNudge={false}
      />
    );
    expect(screen.queryByText(/Qur'an/)).not.toBeInTheDocument();
  });

  it("shows the Business headline and milestones when a Business goal exists", () => {
    render(
      <WeeklyFocus
        deen={null}
        business={{ headline: "Close 3 deals", milestones: ["Follow up with lead A"] }}
        showPlanningNudge={false}
      />
    );
    expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
    expect(screen.getByText("Follow up with lead A")).toBeInTheDocument();
  });

  it("labels each block with its domain name when a goal is set, so the attribution is visible", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 0, quranTarget: null }}
        business={{ headline: "Close 3 deals", milestones: [] }}
        showPlanningNudge={false}
      />
    );
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("labels each block with its domain name when a goal is not set too", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} />);
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("shows a capitalized set-goal link instead of an empty state when a domain has no goal this week", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} />);
    const deenLink = screen.getByRole("link", { name: "Set this week's Deen goal →" });
    const businessLink = screen.getByRole("link", { name: "Set this week's Business goal →" });
    expect(deenLink).toHaveAttribute("href", "/weekly-planning");
    expect(businessLink).toHaveAttribute("href", "/weekly-planning");
  });

  it("uses each domain's own accent color on its set-goal link", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} />);
    expect(screen.getByRole("link", { name: "Set this week's Deen goal →" })).toHaveClass("text-accent-deen");
    expect(screen.getByRole("link", { name: "Set this week's Business goal →" })).toHaveClass(
      "text-accent-business"
    );
  });

  it("shows the Saturday-evening planning nudge when showPlanningNudge is true", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge />);
    expect(screen.getByText("Plan next week's Deen and Business goals →")).toBeInTheDocument();
  });

  it("hides the planning nudge when showPlanningNudge is false", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} />);
    expect(screen.queryByText("Plan next week's Deen and Business goals →")).not.toBeInTheDocument();
  });
});
