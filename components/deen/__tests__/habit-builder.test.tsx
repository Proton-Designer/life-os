import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitBuilder, type DeenHabitData } from "../habit-builder";

vi.mock("@/app/(app)/deen/actions", () => ({
  toggleDeenHabitLog: vi.fn(),
  setWeeklyFocus: vi.fn(),
  createDeenHabit: vi.fn(),
}));

function habit(overrides: Partial<DeenHabitData> = {}): DeenHabitData {
  return { id: "h1", name: "Fajr on time", committedDate: "2026-08-15", streak: 3, completedToday: false, ...overrides };
}

describe("HabitBuilder", () => {
  it("renders stage column titles as Badge pills with the semantic stage mapping", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "a" }), habit({ id: "b", committedDate: "2026-07-01" }), habit({ id: "c", committedDate: "2026-06-01" })]}
        currentFocusHabitId="a"
        previousFocusHabitId={null}
      />
    );
    expect(screen.getByText("Active Build")).toHaveClass("text-accent-info");
    expect(screen.getByText("Stabilized")).toHaveClass("text-accent-business");
    expect(screen.getByText("Locked")).toHaveClass("text-muted-foreground");
  });

  it("renders a habit row's streak in the mono numeral scale", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ streak: 5 })]}
        currentFocusHabitId={null}
        previousFocusHabitId={null}
      />
    );
    expect(screen.getByText("5d").className).toContain("font-mono");
  });

  it("collapses the three redundant 'None yet.' stage columns into one shared EmptyState when there are no habits at all", () => {
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} previousFocusHabitId={null} />
    );
    expect(screen.getByText("No habits started yet")).toBeInTheDocument();
    expect(screen.queryAllByText("None yet.").length).toBe(0);
    expect(screen.queryByText("Active Build")).not.toBeInTheDocument();
  });

  it("keeps a real per-stage 'None yet.' once at least one habit exists somewhere — that's a legitimate empty stage, not noise", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ committedDate: "2026-08-15" })]}
        currentFocusHabitId={null}
        previousFocusHabitId={null}
      />
    );
    expect(screen.queryByText("No habits started yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("None yet.").length).toBeGreaterThan(0);
  });

  it("gives the current focus card a gradient wash and an icon chip", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        previousFocusHabitId={null}
      />
    );
    const card = screen.getByTestId("habit-focus-card");
    expect(card.style.backgroundImage).toContain("--accent-deen");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the day-range for each stage, not just its name", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit({ id: "a" })]}
        currentFocusHabitId={null}
        previousFocusHabitId={null}
      />
    );
    expect(screen.getByText("Days 0–13")).toBeInTheDocument();
    expect(screen.getByText("Days 14–29")).toBeInTheDocument();
    expect(screen.getByText("Day 30+")).toBeInTheDocument();
  });

  it("offers a real, clearly-labeled Add a habit button when a focus is already set — not just a tiny Edit link", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        previousFocusHabitId={null}
      />
    );
    const addButton = screen.getByRole("button", { name: /add a habit/i });
    expect(addButton.tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("offers a real Add a habit button when habits exist but no focus is set this week", () => {
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId={null}
        previousFocusHabitId={null}
      />
    );
    expect(screen.getByRole("button", { name: /add a habit/i })).toBeInTheDocument();
  });

  it("lets you cancel out of the habit picker without picking anything, restoring the previous view", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder
        todayStr="2026-08-15"
        habits={[habit()]}
        currentFocusHabitId="h1"
        previousFocusHabitId={null}
      />
    );

    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    expect(screen.getByPlaceholderText("Or start a new habit")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByPlaceholderText("Or start a new habit")).not.toBeInTheDocument();
    expect(screen.getByTestId("habit-focus-card")).toBeInTheDocument();
  });

  it("cancel from the picker doesn't create or select anything", async () => {
    const user = userEvent.setup();
    render(
      <HabitBuilder todayStr="2026-08-15" habits={[]} currentFocusHabitId={null} previousFocusHabitId={null} />
    );

    await user.click(screen.getByRole("button", { name: /add a habit/i }));
    await user.type(screen.getByPlaceholderText("Or start a new habit"), "Should not be created");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByText("No habits started yet")).toBeInTheDocument();
    expect(screen.queryByText("Should not be created")).not.toBeInTheDocument();
  });
});
