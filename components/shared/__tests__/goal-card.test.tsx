import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalCard } from "../goal-card";

describe("GoalCard", () => {
  it("renders a domain icon chip matching its accent", () => {
    const { container } = render(
      <GoalCard
        title="Deen"
        domain="deen"
        headline=""
        milestones={[]}
        locked={false}
        onSave={vi.fn()}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("still renders the title text", () => {
    render(
      <GoalCard
        title="Business"
        domain="business"
        headline=""
        milestones={[]}
        locked={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("shows optional empty-state framing when the goal has never been saved", () => {
    render(
      <GoalCard
        title="This week's goal"
        domain="business"
        headline=""
        milestones={[]}
        locked={false}
        onSave={vi.fn()}
        emptyStateFraming="The one outcome this week is actually about."
      />
    );
    expect(screen.getByText("The one outcome this week is actually about.")).toBeInTheDocument();
  });

  it("hides the framing once a goal has been saved, even if the prop is still passed", () => {
    render(
      <GoalCard
        title="This week's goal"
        domain="business"
        headline="Close the first paying customer"
        milestones={[]}
        locked={false}
        onSave={vi.fn()}
        emptyStateFraming="The one outcome this week is actually about."
      />
    );
    expect(screen.queryByText("The one outcome this week is actually about.")).not.toBeInTheDocument();
  });

  it("stays absent for callers that never pass the prop — other domains are unaffected", () => {
    render(
      <GoalCard title="Deen" domain="deen" headline="" milestones={[]} locked={false} onSave={vi.fn()} />
    );
    expect(screen.queryByText(/outcome/i)).not.toBeInTheDocument();
  });
});
