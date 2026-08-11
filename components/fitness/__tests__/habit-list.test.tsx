import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitList } from "../habit-list";

const toggleHabitMock = vi.fn();
vi.mock("@/app/(app)/fitness/actions", () => ({
  addHabit: vi.fn(),
  removeHabit: vi.fn(),
  toggleHabit: (...args: unknown[]) => toggleHabitMock(...args),
}));

describe("HabitList", () => {
  beforeEach(() => {
    toggleHabitMock.mockReset();
  });

  it("flips only the clicked habit's visual state immediately, before toggleHabit resolves", async () => {
    toggleHabitMock.mockImplementation(() => new Promise<void>(() => {}));

    render(
      <HabitList
        date="2026-08-11"
        habits={[
          { id: "h1", name: "Read", completedToday: false },
          { id: "h2", name: "Stretch", completedToday: false },
        ]}
      />
    );

    const user = userEvent.setup();
    const buttons = screen.getAllByRole("button", { name: "Mark complete" });
    await user.click(buttons[0]);

    expect(screen.getAllByRole("button", { name: "Mark complete" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mark incomplete" })).toBeInTheDocument();
  });
});
