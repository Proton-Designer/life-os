import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
