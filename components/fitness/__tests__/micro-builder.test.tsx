import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MicroBuilder } from "../workouts/micro-builder";
import type { ExerciseOption } from "../exercise-picker";

const exercises: ExerciseOption[] = [{ id: "ex-1", name: "Pull-ups", primaryMuscles: ["back_lats"], secondaryMuscles: [] }];

describe("MicroBuilder", () => {
  it("adding an exercise updates the live week preview without saving (expandPlanToWeek call site)", async () => {
    const user = userEvent.setup();
    render(
      <MicroBuilder
        initialName="Starter"
        initialExercises={[]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText("Search exercises"), "Pull");
    await user.click(screen.getByRole("button", { name: "Pull-ups" }));

    expect(screen.getByTestId("micro-row-0")).toBeInTheDocument();
    // Default schedule is weekdays (1-5) — the preview must show it on Monday (day 1) without any save call.
    expect(screen.getByTestId("week-preview-day-1").textContent).toContain("Pull-ups");
    expect(screen.getByTestId("week-preview-day-0").textContent).not.toContain("Pull-ups");
  });

  it("removing an exercise clears it from the preview", async () => {
    const user = userEvent.setup();
    render(
      <MicroBuilder
        initialName="Starter"
        initialExercises={[
          {
            id: null,
            exerciseId: "ex-1",
            name: "Pull-ups",
            scheduleDays: [1, 2, 3, 4, 5],
            goalType: "daily_total",
            goalValue: 30,
            notes: null,
          },
        ]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={vi.fn()}
        onDone={vi.fn()}
      />
    );

    expect(screen.getByTestId("week-preview-day-1").textContent).toContain("Pull-ups");
    await user.click(screen.getByRole("button", { name: "Remove Pull-ups" }));
    expect(screen.getByTestId("week-preview-day-1").textContent).not.toContain("Pull-ups");
  });

  it("calls onSave with a full PlanDraft (kind: micro) and then onDone", async () => {
    const onSave = vi.fn().mockResolvedValue({ id: "plan-1" });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <MicroBuilder
        initialName="Starter"
        initialExercises={[
          {
            id: null,
            exerciseId: "ex-1",
            name: "Pull-ups",
            scheduleDays: [1, 2, 3, 4, 5],
            goalType: "daily_total",
            goalValue: 30,
            notes: null,
          },
        ]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={onSave}
        onDone={onDone}
      />
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "micro", id: null, name: "Starter", exercises: expect.any(Array) })
    );
    expect(onDone).toHaveBeenCalled();
  });
});
