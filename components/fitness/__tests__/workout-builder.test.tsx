import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkoutBuilder } from "../workout-builder";
import type { ExerciseOption } from "../exercise-picker";

const ALL_EXERCISES: ExerciseOption[] = [
  { id: "e1", name: "Cable Row", primaryMuscles: ["back_mid"], secondaryMuscles: [] },
  { id: "e2", name: "Cable Press", primaryMuscles: ["chest"], secondaryMuscles: ["triceps"] },
];

function renderBuilder(overrides: Partial<React.ComponentProps<typeof WorkoutBuilder>> = {}) {
  const onCreateExercise = vi.fn();
  const onSaveNew = vi.fn().mockResolvedValue({ id: "w1" });
  const onSaveExisting = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  const utils = render(
    <WorkoutBuilder
      workout={null}
      allExercises={ALL_EXERCISES}
      onCreateExercise={onCreateExercise}
      onSaveNew={onSaveNew}
      onSaveExisting={onSaveExisting}
      onDone={onDone}
      {...overrides}
    />
  );
  return { ...utils, onCreateExercise, onSaveNew, onSaveExisting, onDone };
}

async function addExercise(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText("Search exercises"), name);
  await user.click(screen.getByText(name));
}

describe("WorkoutBuilder", () => {
  it("adding an exercise from the picker appends a row with sensible defaults", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await addExercise(user, "Cable Row");
    expect(screen.getByText("Cable Row")).toBeInTheDocument();
    expect(screen.getByLabelText("Cable Row target sets")).toHaveValue(3);
    expect(screen.getByLabelText("Cable Row target reps low")).toHaveValue(8);
    expect(screen.getByLabelText("Cable Row target reps high")).toHaveValue(10);
  });

  it("removing a row takes it out of the list", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await addExercise(user, "Cable Row");
    await user.click(screen.getByLabelText("Remove Cable Row"));
    expect(screen.queryByText("Cable Row")).not.toBeInTheDocument();
  });

  it("move-down then move-up round-trips the order via up/down buttons, not drag", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await addExercise(user, "Cable Row");
    await addExercise(user, "Cable Press");
    let rows = screen.getAllByText(/Cable (Row|Press)/);
    expect(rows.map((r) => r.textContent)).toEqual(["Cable Row", "Cable Press"]);

    await user.click(screen.getByLabelText("Move Cable Press up"));
    rows = screen.getAllByText(/Cable (Row|Press)/);
    expect(rows.map((r) => r.textContent)).toEqual(["Cable Press", "Cable Row"]);

    await user.click(screen.getByLabelText("Move Cable Press down"));
    rows = screen.getAllByText(/Cable (Row|Press)/);
    expect(rows.map((r) => r.textContent)).toEqual(["Cable Row", "Cable Press"]);
  });

  it("the top row's move-up and the bottom row's move-down are disabled", async () => {
    const user = userEvent.setup();
    renderBuilder();
    await addExercise(user, "Cable Row");
    await addExercise(user, "Cable Press");
    expect(screen.getByLabelText("Move Cable Row up")).toBeDisabled();
    expect(screen.getByLabelText("Move Cable Press down")).toBeDisabled();
  });

  it("saving a new workout calls onSaveNew with the name and ordered exercise list, then onDone", async () => {
    const user = userEvent.setup();
    const { onSaveNew, onDone } = renderBuilder();
    await user.type(screen.getByLabelText("Workout name"), "Push A");
    await addExercise(user, "Cable Row");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(onSaveNew).toHaveBeenCalledWith("Push A", [
      { exerciseId: "e1", targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetLoad: null },
    ]);
    expect(onDone).toHaveBeenCalled();
  });

  it("saving an existing workout calls onSaveExisting with its id, not onSaveNew", async () => {
    const user = userEvent.setup();
    const { onSaveExisting, onSaveNew } = renderBuilder({
      workout: { id: "w9", name: "Push A", exercises: [] },
    });
    await addExercise(user, "Cable Row");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(onSaveExisting).toHaveBeenCalledWith("w9", "Push A", [
      { exerciseId: "e1", targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetLoad: null },
    ]);
    expect(onSaveNew).not.toHaveBeenCalled();
  });

  it("Save is disabled without a name", () => {
    renderBuilder();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks itself dirty after an edit and the Save button reflects it", async () => {
    const user = userEvent.setup();
    renderBuilder();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-dirty", "false");
    await user.type(screen.getByLabelText("Workout name"), "Push A");
    expect(screen.getByRole("button", { name: "Save*" })).toHaveAttribute("data-dirty", "true");
  });

  it("shows the live weekly volume once at least one exercise is added", async () => {
    const user = userEvent.setup();
    renderBuilder();
    expect(screen.queryByTestId("builder-volume")).not.toBeInTheDocument();
    await addExercise(user, "Cable Press");
    expect(screen.getByTestId("builder-volume")).toHaveTextContent("4.5 weekly sets across 2 muscle groups");
  });

  it("surfaces an untagged-exercise note passively rather than blocking save", async () => {
    const user = userEvent.setup();
    const untaggedExercise: ExerciseOption = { id: "e3", name: "Mystery Move", primaryMuscles: [], secondaryMuscles: [] };
    renderBuilder({ allExercises: [...ALL_EXERCISES, untaggedExercise] });
    await addExercise(user, "Mystery Move");
    expect(screen.getByTestId("builder-volume")).toHaveTextContent("aren't counted in your volume");
    await user.type(screen.getByLabelText("Workout name"), "Push A");
    expect(screen.getByRole("button", { name: "Save*" })).not.toBeDisabled();
  });
});
