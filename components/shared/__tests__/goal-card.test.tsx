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
});
