import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RepGoalBars, type RepGoalBar } from "../rep-goal-bars";

const GOALS: RepGoalBar[] = [
  { exerciseId: "e1", exerciseName: "Pull-ups", dailyTarget: 30, loggedRepsToday: 18 },
  { exerciseId: "e2", exerciseName: "Push-ups", dailyTarget: 100, loggedRepsToday: 60 },
];

describe("RepGoalBars", () => {
  it("renders nothing when there are no active goals today", () => {
    const { container } = render(<RepGoalBars goals={[]} onLog={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each goal's progress as done/target", () => {
    render(<RepGoalBars goals={GOALS} onLog={vi.fn()} />);
    expect(screen.getByTestId("rep-goal-bar-e1")).toHaveTextContent("18/30");
    expect(screen.getByTestId("rep-goal-bar-e2")).toHaveTextContent("60/100");
  });

  it("tapping a bar is its own quick-add entry point — expands a reps input, exercise already known", async () => {
    const user = userEvent.setup();
    render(<RepGoalBars goals={GOALS} onLog={vi.fn()} />);
    expect(screen.queryByTestId("rep-goal-quick-add-e1")).not.toBeInTheDocument();
    await user.click(screen.getByText("Pull-ups"));
    expect(screen.getByTestId("rep-goal-quick-add-e1")).toBeInTheDocument();
    expect(screen.getByLabelText("Pull-ups reps this bout")).toBeInTheDocument();
  });

  it("logging calls onLog with the exercise and entered reps, then collapses", async () => {
    const user = userEvent.setup();
    const onLog = vi.fn().mockResolvedValue(undefined);
    render(<RepGoalBars goals={GOALS} onLog={onLog} />);
    await user.click(screen.getByText("Pull-ups"));
    const repsInput = screen.getByLabelText("Pull-ups reps this bout");
    await user.clear(repsInput);
    await user.type(repsInput, "5");
    await user.click(screen.getByRole("button", { name: "Log" }));
    expect(onLog).toHaveBeenCalledWith("e1", "Pull-ups", 5);
    expect(await screen.findByText("Pull-ups")).toBeInTheDocument();
    expect(screen.queryByTestId("rep-goal-quick-add-e1")).not.toBeInTheDocument();
  });
});
