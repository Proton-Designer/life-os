import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeeklyFocus } from "../weekly-focus";

function noop() {
  return Promise.resolve();
}

describe("WeeklyFocus", () => {
  it("shows the Deen headline and milestones when a Deen goal exists", () => {
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
  });

  it("shows the Qur'an progress line only when a quranTarget is set", () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 12, quranTarget: 20 }}
        business={null}
        showPlanningNudge={false}
        onSaveDeen={noop}
        onSaveBusiness={noop}
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
        onSaveDeen={noop}
        onSaveBusiness={noop}
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
        onSaveDeen={noop}
        onSaveBusiness={noop}
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
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("opens straight into the editable goal form for a domain with no goal set yet, no read-only link to click through", () => {
    render(<WeeklyFocus deen={null} business={null} showPlanningNudge={false} onSaveDeen={noop} onSaveBusiness={noop} />);
    // GoalCard renders the domain title as a heading, and a headline input per domain.
    expect(screen.getAllByText("Deen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Business").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("This week's headline goal")).toHaveLength(2);
  });

  it("shows a pencil edit control on a domain that already has a goal, and switches to the editable form on click", async () => {
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 0, quranTarget: null }}
        business={{ headline: "Close 3 deals", milestones: [] }}
        showPlanningNudge={false}
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit this week's Deen goal" }));

    expect(screen.getByPlaceholderText("This week's headline goal")).toHaveValue("Finish Juz 5");
  });

  it("calls the domain's own save callback with the edited headline, and returns to the read view after saving", async () => {
    // Props stay whatever the test passed in — a real page revalidates and
    // streams a fresh `deen` prop after the server action resolves (same
    // reliance as the Co-op TargetRow/TaskCard edit-toggle pattern), which
    // this render-only test doesn't simulate. Starting from an existing
    // (non-null) goal, rather than null, keeps the post-save read view from
    // rendering a goal that's still null.
    // business is set (not null) so it stays in read view — otherwise both
    // domains open into edit mode at once and their identical "This week's
    // headline goal" placeholders collide.
    const onSaveDeen = vi.fn(() => Promise.resolve());
    render(
      <WeeklyFocus
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 0, quranTarget: null }}
        business={{ headline: "Close 3 deals", milestones: [] }}
        showPlanningNudge={false}
        onSaveDeen={onSaveDeen}
        onSaveBusiness={noop}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit this week's Deen goal" }));
    await user.clear(screen.getByPlaceholderText("This week's headline goal"));
    await user.type(screen.getByPlaceholderText("This week's headline goal"), "Finish Juz 10");
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    expect(onSaveDeen).toHaveBeenCalledWith("Finish Juz 10", [], undefined);
    expect(await screen.findByText("Finish Juz 5")).toBeInTheDocument();
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
