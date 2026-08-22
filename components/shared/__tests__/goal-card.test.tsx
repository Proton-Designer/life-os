import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalCard } from "../goal-card";

describe("GoalCard", () => {
  it("renders a domain icon chip matching its accent", () => {
    const { container } = render(
      <GoalCard title="Deen" domain="deen" headline="" milestones={[]} locked={false} onSave={vi.fn()} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("still renders the title text", () => {
    render(
      <GoalCard title="Business" domain="business" headline="" milestones={[]} locked={false} onSave={vi.fn()} />
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
    render(<GoalCard title="Deen" domain="deen" headline="" milestones={[]} locked={false} onSave={vi.fn()} />);
    expect(screen.queryByText(/outcome/i)).not.toBeInTheDocument();
  });

  it("opens straight into the editable form when no goal has been saved yet", () => {
    render(<GoalCard title="Business" domain="business" headline="" milestones={[]} locked={false} onSave={vi.fn()} />);
    expect(screen.getByPlaceholderText("This week's headline goal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save goal" })).toBeInTheDocument();
  });

  it("defaults to a read view — headline and milestones as bullets, no form — once a goal exists", () => {
    render(
      <GoalCard
        title="Business"
        domain="business"
        headline="Close 3 deals"
        milestones={["Follow up with lead A", "Send proposal to lead B"]}
        locked={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
    expect(screen.getByText("Follow up with lead A")).toBeInTheDocument();
    expect(screen.getByText("Send proposal to lead B")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("This week's headline goal")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save goal" })).not.toBeInTheDocument();
  });

  it("shows the Qur'an progress line in the read view only when a target is set", () => {
    render(
      <GoalCard
        title="Deen"
        domain="deen"
        headline="Finish Juz 5"
        milestones={[]}
        quranPageTarget={20}
        quranPagesRead={12}
        showQuranTarget
        locked={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText("Qur'an 12/20 pages")).toBeInTheDocument();
  });

  it("omits the Qur'an progress line when no target is set", () => {
    render(
      <GoalCard
        title="Deen"
        domain="deen"
        headline="Finish Juz 5"
        milestones={[]}
        showQuranTarget
        locked={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByText(/Qur'an/)).not.toBeInTheDocument();
  });

  it("shows an edit button in the read view that switches to the pre-filled form", async () => {
    render(
      <GoalCard
        title="Business"
        domain="business"
        headline="Close 3 deals"
        milestones={["Follow up with lead A"]}
        locked={false}
        onSave={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Business" }));

    expect(screen.getByPlaceholderText("This week's headline goal")).toHaveValue("Close 3 deals");
    expect(screen.getByPlaceholderText("Milestones (one per line)")).toHaveValue("Follow up with lead A");
  });

  it("calls onSave with the edited fields and returns to the read view on save", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <GoalCard
        title="Business"
        domain="business"
        headline="Close 3 deals"
        milestones={[]}
        locked={false}
        onSave={onSave}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Business" }));
    await user.clear(screen.getByPlaceholderText("This week's headline goal"));
    await user.type(screen.getByPlaceholderText("This week's headline goal"), "Close 5 deals");
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    expect(onSave).toHaveBeenCalledWith("Close 5 deals", [], undefined);
    // Props are unchanged in this render-only test (a real page revalidates
    // and streams a fresh `headline` prop after the server action resolves,
    // same reliance as the Work TargetRow/TaskCard edit-toggle pattern) — so
    // the read view that reappears still shows the original saved headline.
    expect(await screen.findByText("Close 3 deals")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("This week's headline goal")).not.toBeInTheDocument();
  });

  it("has no edit button while locked", () => {
    render(
      <GoalCard title="Deen" domain="deen" headline="Finish Juz 5" milestones={[]} locked onSave={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Edit Deen" })).not.toBeInTheDocument();
  });
});
