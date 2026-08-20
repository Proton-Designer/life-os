import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeFitnessPanel } from "../home-fitness-panel";

describe("HomeFitnessPanel", () => {
  it("composes rep bars and quick-add without crashing", () => {
    render(
      <HomeFitnessPanel
        repGoals={[{ exerciseId: "e1", exerciseName: "Pull-ups", dailyTarget: 30, loggedRepsToday: 10 }]}
        quickAddExercises={[]}
        onQuickLogExercise={vi.fn()}
        onCreateExercise={vi.fn()}
      />
    );
    expect(screen.getByText("Pull-ups")).toBeInTheDocument();
    expect(screen.getByText("+ Quick log")).toBeInTheDocument();
  });

  it("no longer renders weight/waist logging — that moved to the Fitness page's Body panel", () => {
    render(
      <HomeFitnessPanel
        repGoals={[]}
        quickAddExercises={[]}
        onQuickLogExercise={vi.fn()}
        onCreateExercise={vi.fn()}
      />
    );
    expect(screen.queryByText("Log weight")).not.toBeInTheDocument();
    expect(screen.queryByText("Log your waist")).not.toBeInTheDocument();
  });

  it("a rep-goal bar's quick-add adapts to the single onQuickLogExercise signature with sets=1 and no load", async () => {
    const user = userEvent.setup();
    const onQuickLogExercise = vi.fn().mockResolvedValue(undefined);
    render(
      <HomeFitnessPanel
        repGoals={[{ exerciseId: "e1", exerciseName: "Pull-ups", dailyTarget: 30, loggedRepsToday: 10 }]}
        quickAddExercises={[]}
        onQuickLogExercise={onQuickLogExercise}
        onCreateExercise={vi.fn()}
      />
    );
    await user.click(screen.getByText("Pull-ups"));
    const repsInput = screen.getByLabelText("Pull-ups reps this bout");
    await user.clear(repsInput);
    await user.type(repsInput, "5");
    await user.click(screen.getByRole("button", { name: "Log" }));
    expect(onQuickLogExercise).toHaveBeenCalledWith("e1", "Pull-ups", 1, 5, null);
  });
});
