import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickAddSheet } from "../quick-add-sheet";
import type { ExerciseOption } from "../exercise-picker";

const EXERCISES: ExerciseOption[] = [{ id: "e1", name: "Push-ups", primaryMuscles: ["chest"], secondaryMuscles: [] }];

describe("QuickAddSheet", () => {
  it("opens on tap and shows the exercise picker first", async () => {
    const user = userEvent.setup();
    render(<QuickAddSheet exercises={EXERCISES} onCreateExercise={vi.fn()} onLog={vi.fn()} />);
    await user.click(screen.getByText("+ Quick log"));
    expect(screen.getByTestId("exercise-picker")).toBeInTheDocument();
  });

  it("selecting an exercise reveals sets/reps/load entry, exercise already known", async () => {
    const user = userEvent.setup();
    render(<QuickAddSheet exercises={EXERCISES} onCreateExercise={vi.fn()} onLog={vi.fn()} />);
    await user.click(screen.getByText("+ Quick log"));
    await user.type(screen.getByLabelText("Search exercises"), "Push-ups");
    await user.click(screen.getByText("Push-ups"));
    expect(screen.getAllByText("Push-ups").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Sets")).toBeInTheDocument();
    expect(screen.getByLabelText("Reps")).toBeInTheDocument();
  });

  it("logging calls onLog with the selected exercise and entered values, without asking which session", async () => {
    const user = userEvent.setup();
    const onLog = vi.fn().mockResolvedValue(undefined);
    render(<QuickAddSheet exercises={EXERCISES} onCreateExercise={vi.fn()} onLog={onLog} />);
    await user.click(screen.getByText("+ Quick log"));
    await user.type(screen.getByLabelText("Search exercises"), "Push-ups");
    await user.click(screen.getByText("Push-ups"));
    const repsInput = screen.getByLabelText("Reps");
    await user.clear(repsInput);
    await user.type(repsInput, "20");
    await user.click(screen.getByRole("button", { name: "Log it" }));
    expect(onLog).toHaveBeenCalledWith("e1", "Push-ups", 1, 20, null);
  });
});
