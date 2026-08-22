import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoutineBuilder } from "../workouts/routine-builder";
import type { ExerciseOption } from "../exercise-picker";

const exercises: ExerciseOption[] = [{ id: "ex-1", name: "Cable chest press", primaryMuscles: ["chest"], secondaryMuscles: [] }];

describe("RoutineBuilder", () => {
  it("adding a session and an exercise to it updates the live week preview", async () => {
    const user = userEvent.setup();
    render(
      <RoutineBuilder
        initialName="Push/Pull"
        initialSessions={[]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "+ Add session" }));
    await user.type(screen.getByLabelText("Session 1 name"), "Push day");
    await user.type(screen.getByLabelText("Search exercises"), "Cable");
    await user.click(screen.getByRole("button", { name: "Cable chest press" }));

    expect(screen.getByTestId("session-0-exercise-0")).toBeInTheDocument();
    // Default schedule is weekdays — preview should show the session on Monday (day 1).
    expect(screen.getByTestId("week-preview-day-1").textContent).toContain("Push day");
  });

  it("requires a duration on each session exercise but not a save-blocking name for the exercise itself", async () => {
    const user = userEvent.setup();
    render(
      <RoutineBuilder
        initialName="Push/Pull"
        initialSessions={[]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={vi.fn()}
        onDone={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "+ Add session" }));
    await user.type(screen.getByLabelText("Session 1 name"), "Push day");
    await user.type(screen.getByLabelText("Search exercises"), "Cable");
    await user.click(screen.getByRole("button", { name: "Cable chest press" }));

    expect(screen.getByLabelText("Cable chest press duration minutes")).toHaveValue(10);
  });

  it("blocks save until every session has a name", async () => {
    const user = userEvent.setup();
    render(
      <RoutineBuilder
        initialName="Push/Pull"
        initialSessions={[]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={vi.fn()}
        onDone={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "+ Add session" }));
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("calls onSave with a full routine PlanDraft including nested session exercises", async () => {
    const onSave = vi.fn().mockResolvedValue({ id: "plan-2" });
    const user = userEvent.setup();
    render(
      <RoutineBuilder
        initialName="Push/Pull"
        initialSessions={[
          {
            id: null,
            name: "Push day",
            scheduleDays: [1, 3, 5],
            startTime: "07:00",
            exercises: [
              {
                id: null,
                exerciseId: "ex-1",
                name: "Cable chest press",
                durationMinutes: 12,
                loadLb: null,
                targetSets: 3,
                targetReps: 10,
              },
            ],
          },
        ]}
        planId={null}
        allExercises={exercises}
        onCreateExercise={vi.fn()}
        onSave={onSave}
        onDone={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "routine",
        name: "Push/Pull",
        sessions: [expect.objectContaining({ name: "Push day", startTime: "07:00" })],
      })
    );
  });
});
