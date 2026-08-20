import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssignWorkoutPicker } from "../assign-workout-picker";

describe("AssignWorkoutPicker", () => {
  it("shows a guiding message rather than a dead end when there are no saved workouts", () => {
    render(<AssignWorkoutPicker workouts={[]} onAssign={vi.fn()} />);
    expect(screen.getByTestId("assign-no-workouts")).toHaveTextContent("create one in My Workouts");
  });

  it("opens the list on tap and assigning calls onAssign with the workout id", async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn().mockResolvedValue(undefined);
    render(<AssignWorkoutPicker workouts={[{ id: "w1", name: "Push A" }]} onAssign={onAssign} />);
    await user.click(screen.getByText("Assign a workout"));
    await user.click(screen.getByText("Push A"));
    expect(onAssign).toHaveBeenCalledWith("w1");
  });
});
