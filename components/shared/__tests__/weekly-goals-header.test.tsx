import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeeklyGoalsHeader } from "../weekly-goals-header";

function noop() {
  return Promise.resolve();
}

// GoalCard itself owns the read/edit/save behavior (see
// components/shared/__tests__/goal-card.test.tsx) — this file confirms the
// combined module wires the right goal data into each domain's slot, opens
// GoalCard's editing form (not a reimplementation) from the edit icon, and
// routes saves + the planning nudge correctly. Editing used to live only in
// the deleted bottom "This week's focus" panel; this module is now the only
// place it lives.
describe("WeeklyGoalsHeader", () => {
  it("shows an explicit DEEN/BUSINESS label, headline, and 'This Week's Focus' subtitle", () => {
    render(
      <WeeklyGoalsHeader
        deen={{ headline: "Finish Surah Kahf", milestones: [] }}
        business={{ headline: "Ship the landing page", milestones: [] }}
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    expect(screen.getByText("This Week's Focus")).toBeInTheDocument();
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toBeInTheDocument();
  });

  it("shows a distinct 'set this week's goal' prompt for an empty slot, per domain", () => {
    render(
      <WeeklyGoalsHeader
        deen={null}
        business={{ headline: "Ship the landing page", milestones: [] }}
        onSaveDeen={noop}
        onSaveBusiness={noop}
      />
    );
    expect(screen.getByText(/Set this week's Deen goal/)).toBeInTheDocument();
    expect(screen.queryByText(/Set this week's Business goal/)).not.toBeInTheDocument();
  });

  it("opens the Deen goal straight into an editable form via its edit icon, and routes the save to onSaveDeen only", async () => {
    const onSaveDeen = vi.fn(() => Promise.resolve());
    const onSaveBusiness = vi.fn(() => Promise.resolve());
    render(
      <WeeklyGoalsHeader
        deen={{ headline: "Finish Juz 5", milestones: [], quranPages: 0, quranTarget: null }}
        business={{ headline: "Close 3 deals", milestones: [] }}
        onSaveDeen={onSaveDeen}
        onSaveBusiness={onSaveBusiness}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Deen goal" }));
    expect(screen.getByPlaceholderText("This week's headline goal")).toHaveValue("Finish Juz 5");

    await user.clear(screen.getByPlaceholderText("This week's headline goal"));
    await user.type(screen.getByPlaceholderText("This week's headline goal"), "Finish Juz 10");
    await user.click(screen.getByRole("button", { name: "Save goal" }));

    expect(onSaveDeen).toHaveBeenCalledWith("Finish Juz 10", [], undefined);
    expect(onSaveBusiness).not.toHaveBeenCalled();
  });

  it("shows the weekend planning nudge only when showPlanningNudge is true", () => {
    const { rerender } = render(
      <WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} showPlanningNudge />
    );
    expect(screen.getByText(/set next week's deen and business goals below/i)).toBeInTheDocument();

    rerender(
      <WeeklyGoalsHeader
        deen={null}
        business={null}
        onSaveDeen={noop}
        onSaveBusiness={noop}
        showPlanningNudge={false}
      />
    );
    expect(screen.queryByText(/set next week's deen and business goals below/i)).not.toBeInTheDocument();
  });

  it("renders both slots even when neither goal is set", () => {
    render(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText(/Set this week's Deen goal/)).toBeInTheDocument();
    expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
  });

  // A row can exist with a blank headline — saveWeeklyGoal deliberately
  // doesn't reject an empty string, since clearing a goal is legitimate
  // (Opus Lead, 2026-08-24). The slot must fall back to the same "Set this
  // week's X goal" prompt as a genuinely unset (null) goal, not a blank line
  // with no way back to the prompt.
  describe("a blank headline reads as unset, same as no goal at all", () => {
    it("treats an empty-string headline as unset, for both Deen and Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "", milestones: [] }}
          business={{ headline: "", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
        />
      );
      expect(screen.getByText(/Set this week's Deen goal/)).toBeInTheDocument();
      expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
    });

    it("treats a whitespace-only headline as unset, for both Deen and Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "   ", milestones: [] }}
          business={{ headline: "\n\t ", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
        />
      );
      expect(screen.getByText(/Set this week's Deen goal/)).toBeInTheDocument();
      expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
    });

    it("still shows a real headline normally, for both Deen and Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "Finish Juz 5", milestones: [] }}
          business={{ headline: "Close 3 deals", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
        />
      );
      expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
      expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
      expect(screen.queryByText(/Set this week's Deen goal/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Set this week's Business goal/)).not.toBeInTheDocument();
    });
  });
});
