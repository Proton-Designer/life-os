import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeeklyFocus } from "../weekly-focus";

function noop() {
  return Promise.resolve();
}

// GoalCard now owns the read-view/edit-toggle/save behavior itself (see
// components/shared/__tests__/goal-card.test.tsx for that coverage) —
// WeeklyFocus's own tests just confirm it wires the right goal data,
// showQuranTarget, and save callback into each domain's GoalCard.
describe("WeeklyFocus", () => {
  it("shows the Deen headline, milestones, and Qur'an progress when a Deen goal exists", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: ["Read after Fajr", "Review with tutor"], quranPages: 12, quranTarget: 20 }}
        business={null}
        showPlanningNudge={false}
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
    expect(screen.getByText("Read after Fajr")).toBeInTheDocument();
    expect(screen.getByText("Review with tutor")).toBeInTheDocument();
    expect(screen.getByText("Qur'an 12/20 pages")).toBeInTheDocument();
  });

  it("shows the Business headline and milestones when a Business goal exists, with no Qur'an line", () => {
    render(
      <WeeklyFocus
        deen={null}
        business={{ headline: "Close 3 deals", milestones: ["Follow up with lead A"] }}
        showPlanningNudge={false}
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
    expect(screen.getByText("Follow up with lead A")).toBeInTheDocument();
    expect(screen.queryByText(/Qur'an/)).not.toBeInTheDocument();
  });

  it("opens straight into the editable goal form for a domain with no goal set yet", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getAllByPlaceholderText("This week's headline goal")).toHaveLength(2);
  });

  it("routes each domain's edited headline to its own save callback", async () => {
    const onSaveDeen = vi.fn(() => Promise.resolve());
    const onSaveBusiness = vi.fn(() => Promise.resolve());
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 0, quranTarget: null }}
        business={{ headline: "Close 3 deals", milestones: [] }}
        showPlanningNudge={false}
        onSaveDeen={onSaveDeen}
        onSaveBusiness={onSaveBusiness}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Deen" }));
    await user.clear(screen.getByPlaceholderText("This week's headline goal"));
    await user.type(screen.getByPlaceholderText("This week's headline goal"), "Finish Juz 10");
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    expect(onSaveDeen).toHaveBeenCalledWith("Finish Juz 10", [], undefined);
    expect(onSaveBusiness).not.toHaveBeenCalled();
  });

  it("shows the weekend planning nudge when showPlanningNudge is true", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText(/set next week's deen and business goals below/i)).toBeInTheDocument();
  });

  it("hides the planning nudge when showPlanningNudge is false", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.queryByText(/set next week's deen and business goals below/i)).not.toBeInTheDocument();
  });
});
