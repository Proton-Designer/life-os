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
    expect(screen.getByText("Faith")).toBeInTheDocument();
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
    expect(screen.getByText(/Set this week's Faith goal/)).toBeInTheDocument();
    expect(screen.queryByText(/Set this week's Business goal/)).not.toBeInTheDocument();
  });

  it("opens the Faith goal straight into an editable form via its edit icon, and routes the save to onSaveDeen only", async () => {
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
    await user.click(screen.getByRole("button", { name: "Edit Faith goal" }));
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
    expect(screen.getByText(/set next week's faith and business goals below/i)).toBeInTheDocument();

    rerender(
      <WeeklyGoalsHeader
        deen={null}
        business={null}
        onSaveDeen={noop}
        onSaveBusiness={noop}
        showPlanningNudge={false}
      />
    );
    expect(screen.queryByText(/set next week's faith and business goals below/i)).not.toBeInTheDocument();
  });

  it("renders both slots even when neither goal is set", () => {
    render(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText(/Set this week's Faith goal/)).toBeInTheDocument();
    expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
  });

  // A row can exist with a blank headline — saveWeeklyGoal deliberately
  // doesn't reject an empty string, since clearing a goal is legitimate
  // (Opus Lead, 2026-08-24). The slot must fall back to the same "Set this
  // week's X goal" prompt as a genuinely unset (null) goal, not a blank line
  // with no way back to the prompt.
  describe("a blank headline reads as unset, same as no goal at all", () => {
    it("treats an empty-string headline as unset, for both Faith and Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "", milestones: [] }}
          business={{ headline: "", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
        />
      );
      expect(screen.getByText(/Set this week's Faith goal/)).toBeInTheDocument();
      expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
    });

    it("treats a whitespace-only headline as unset, for both Faith and Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "   ", milestones: [] }}
          business={{ headline: "\n\t ", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
        />
      );
      expect(screen.getByText(/Set this week's Faith goal/)).toBeInTheDocument();
      expect(screen.getByText(/Set this week's Business goal/)).toBeInTheDocument();
    });

    it("still shows a real headline normally, for both Faith and Business", () => {
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
      expect(screen.queryByText(/Set this week's Faith goal/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Set this week's Business goal/)).not.toBeInTheDocument();
    });
  });

  describe("showDeen / showBusiness gating", () => {
    it("hides the Business slot when showBusiness is false, keeps Faith", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "Finish Juz 5", milestones: [] }}
          business={{ headline: "Close 3 deals", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
          showBusiness={false}
        />
      );
      expect(screen.getByText("Finish Juz 5")).toBeInTheDocument();
      expect(screen.queryByText("Close 3 deals")).not.toBeInTheDocument();
      expect(screen.queryByText("Business")).not.toBeInTheDocument();
    });

    it("hides the Faith slot when showDeen is false, keeps Business", () => {
      render(
        <WeeklyGoalsHeader
          deen={{ headline: "Finish Juz 5", milestones: [] }}
          business={{ headline: "Close 3 deals", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
          showDeen={false}
        />
      );
      expect(screen.queryByText("Finish Juz 5")).not.toBeInTheDocument();
      expect(screen.getByText("Close 3 deals")).toBeInTheDocument();
    });

    it("hides the whole module -- including the 'This Week's Focus' heading -- when both are false, rather than rendering an empty frame", () => {
      const { container } = render(
        <WeeklyGoalsHeader
          deen={{ headline: "Finish Juz 5", milestones: [] }}
          business={{ headline: "Close 3 deals", milestones: [] }}
          onSaveDeen={noop}
          onSaveBusiness={noop}
          showDeen={false}
          showBusiness={false}
        />
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("defaults both to true when the caller doesn't pass them at all -- Calendar's header and any other existing caller is unaffected", () => {
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
    });
  });

  it("Faith Mode OFF (showDeen false): no Faith slot, and the weekend nudge no longer names Faith", () => {
    render(
      <WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} showDeen={false} showPlanningNudge />
    );
    expect(screen.queryByText("Faith")).not.toBeInTheDocument();
    expect(screen.getByText(/set next week's Business goal below/)).toBeInTheDocument();
    expect(screen.queryByText(/Faith/)).not.toBeInTheDocument();
  });

  it("ON keeps the Faith wording in the weekend nudge (positive control)", () => {
    render(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} showPlanningNudge />);
    expect(screen.getByText(/Faith and Business goals/)).toBeInTheDocument();
  });

  it("renders optional extraActions beside the title (Home's Goals button) and nothing extra without them", () => {
    const { rerender } = render(
      <WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} extraActions={<button type="button">Goals</button>} />
    );
    expect(screen.getByRole("button", { name: "Goals" })).toBeInTheDocument();
    rerender(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.queryByRole("button", { name: "Goals" })).not.toBeInTheDocument();
  });

  // HOME-02: the floating "+" capture button lives at the far right; the Goals button sits beside the title instead.
  it("puts extraActions right beside the title, not pushed to the far right (clear of the floating +)", () => {
    render(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} extraActions={<button type="button">Goals</button>} />);
    const row = screen.getByText("This Week's Focus").parentElement!;
    expect(row).toContainElement(screen.getByRole("button", { name: "Goals" }));
    expect(row.className).not.toContain("justify-between");
  });

  // Home's slim title-row version (compact). Calendar's layout above must stay as it was.
  describe("compact (Home's title row)", () => {
    const base = { onSaveDeen: noop, onSaveBusiness: noop, compact: true } as const;

    it("both goals: side by side in one column group, headline in a title tooltip, same id / testid", () => {
      render(<WeeklyGoalsHeader {...base} deen={{ headline: "Read 3 pages of Quran everyday", milestones: [] }} business={{ headline: "Get interns onboarded efficiently and delegate tasks", milestones: [] }} />);
      const header = screen.getByTestId("weekly-goals-header");
      expect(header).toHaveAttribute("id", "weekly-focus");
      const deen = screen.getByText("Read 3 pages of Quran everyday");
      const business = screen.getByText("Get interns onboarded efficiently and delegate tasks");
      expect(deen).toHaveAttribute("title", "Read 3 pages of Quran everyday");
      expect(business).toHaveAttribute("title", "Get interns onboarded efficiently and delegate tasks");
      expect(deen.parentElement!.parentElement!.parentElement).toBe(business.parentElement!.parentElement!.parentElement); // one shared row
      expect(deen.className).toContain("md:line-clamp-1"); // one line (ellipsis) from md up
      expect(deen.className).toContain("line-clamp-2"); // two lines on a phone
      expect(screen.getByRole("button", { name: "Edit Faith goal" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Business goal" })).toBeInTheDocument();
    });

    it("keeps the 'This Week's Focus' heading for screen readers and shows it only from lg", () => {
      render(<WeeklyGoalsHeader {...base} deen={null} business={null} />);
      const h = screen.getByRole("heading", { name: "This Week's Focus" });
      expect(h.className).toContain("sr-only");
      expect(h.className).toContain("lg:not-sr-only");
    });

    it("one goal only: the other slot is absent and the remaining one is the only column", () => {
      render(<WeeklyGoalsHeader {...base} showDeen={false} deen={{ headline: "ignored", milestones: [] }} business={{ headline: "Ship it", milestones: [] }} />);
      expect(screen.getByText("Ship it")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit Faith goal" })).not.toBeInTheDocument();
      expect(screen.queryByText("ignored")).not.toBeInTheDocument();
    });

    it("no goals visible: nothing renders", () => {
      const { container } = render(<WeeklyGoalsHeader {...base} showDeen={false} showBusiness={false} deen={null} business={null} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("an empty slot shows the prompt and a + (still the 'Edit ... goal' button), a set slot a pencil", () => {
      render(<WeeklyGoalsHeader {...base} deen={null} business={{ headline: "Ship it", milestones: [] }} />);
      expect(screen.getByText(/Set this week's Faith goal/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Faith goal" }).querySelector("svg.lucide-plus")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Edit Business goal" }).querySelector("svg.lucide-pencil")).not.toBeNull();
    });

    it("the weekend nudge is a dot + tooltip on the Goals control, not a text line; absent when not the weekend", () => {
      const goals = <button type="button" aria-label="Goals">G</button>;
      const { rerender } = render(<WeeklyGoalsHeader {...base} deen={null} business={null} extraActions={goals} showPlanningNudge />);
      expect(screen.getByTestId("weekly-nudge-dot")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Goals" }).parentElement).toHaveAttribute("title", expect.stringMatching(/weekend — set next week's Faith and Business goals/));
      rerender(<WeeklyGoalsHeader {...base} showDeen={false} deen={null} business={null} extraActions={goals} showPlanningNudge />);
      expect(screen.getByRole("button", { name: "Goals" }).parentElement).toHaveAttribute("title", expect.stringMatching(/Business goal\./));
      expect(screen.getByRole("button", { name: "Goals" }).parentElement!.getAttribute("title")).not.toMatch(/Faith/);
      rerender(<WeeklyGoalsHeader {...base} deen={null} business={null} extraActions={goals} />);
      expect(screen.queryByTestId("weekly-nudge-dot")).not.toBeInTheDocument();
    });

    it("editing in compact mode still opens GoalCard's dialog and saves to the right domain", async () => {
      const onSaveBusiness = vi.fn(() => Promise.resolve());
      render(<WeeklyGoalsHeader {...base} onSaveBusiness={onSaveBusiness} deen={null} business={{ headline: "Close 3 deals", milestones: [] }} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit Business goal" }));
      await user.clear(screen.getByPlaceholderText("This week's headline goal"));
      await user.type(screen.getByPlaceholderText("This week's headline goal"), "Close 5 deals");
      await user.click(screen.getByRole("button", { name: "Save goal" }));
      expect(onSaveBusiness).toHaveBeenCalledWith("Close 5 deals", [], undefined);
    });

    it("phone: the whole slot is the edit button (an overlay, icon hidden below md); md and up keep the small icon button -- same accessible name and dialog", async () => {
      render(<WeeklyGoalsHeader {...base} deen={{ headline: "Read 3 pages of Quran everyday", milestones: [] }} business={null} />);
      const edit = screen.getByRole("button", { name: "Edit Faith goal" });
      expect(edit.className).toContain("max-md:absolute");
      expect(edit.className).toContain("max-md:inset-0");
      expect(edit.querySelector("svg")!.getAttribute("class")).toContain("max-md:hidden");
      expect(edit.className).toContain("size-6"); // md and up: the small icon button
      expect(edit.parentElement!.className).toContain("relative"); // the overlay is positioned over its own slot only
      await userEvent.setup().click(edit);
      expect(screen.getByPlaceholderText("This week's headline goal")).toHaveValue("Read 3 pages of Quran everyday");
    });

    it("the non-compact (Calendar) layout is unchanged: heading visible, nudge is still a text line, no dot", () => {
      render(<WeeklyGoalsHeader deen={null} business={null} onSaveDeen={noop} onSaveBusiness={noop} showPlanningNudge />);
      expect(screen.getByText("This Week's Focus").className).not.toContain("sr-only");
      expect(screen.getByText(/set next week's faith and business goals below/i)).toBeInTheDocument();
      expect(screen.queryByTestId("weekly-nudge-dot")).not.toBeInTheDocument();
    });
  });
});
