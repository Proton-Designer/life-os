import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExercisePicker, type ExerciseOption } from "../exercise-picker";

const EXERCISES: ExerciseOption[] = [
  { id: "e1", name: "Cable Row", primaryMuscles: ["back_mid"], secondaryMuscles: [] },
  { id: "e2", name: "Cable Press", primaryMuscles: ["chest"], secondaryMuscles: ["triceps"] },
];

describe("ExercisePicker", () => {
  it("filters exercises by search query", async () => {
    const user = userEvent.setup();
    render(<ExercisePicker exercises={EXERCISES} onSelect={vi.fn()} onCreate={vi.fn()} />);
    await user.type(screen.getByLabelText("Search exercises"), "Row");
    expect(screen.getByText("Cable Row")).toBeInTheDocument();
    expect(screen.queryByText("Cable Press")).not.toBeInTheDocument();
  });

  it("selecting an existing exercise calls onSelect and clears the query", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ExercisePicker exercises={EXERCISES} onSelect={onSelect} onCreate={vi.fn()} />);
    await user.type(screen.getByLabelText("Search exercises"), "Cable Row");
    await user.click(screen.getByText("Cable Row"));
    expect(onSelect).toHaveBeenCalledWith(EXERCISES[0]);
    expect(screen.getByLabelText("Search exercises")).toHaveValue("");
  });

  it("offers to add a new exercise when the query has no exact match", async () => {
    const user = userEvent.setup();
    render(<ExercisePicker exercises={EXERCISES} onSelect={vi.fn()} onCreate={vi.fn()} />);
    await user.type(screen.getByLabelText("Search exercises"), "Landmine Press");
    expect(screen.getByText('+ Add "Landmine Press" as a new exercise')).toBeInTheDocument();
  });

  it("does not offer to add a new exercise when the query exactly matches an existing one", async () => {
    const user = userEvent.setup();
    render(<ExercisePicker exercises={EXERCISES} onSelect={vi.fn()} onCreate={vi.fn()} />);
    await user.type(screen.getByLabelText("Search exercises"), "Cable Row");
    expect(screen.queryByText(/Add "Cable Row" as a new exercise/)).not.toBeInTheDocument();
  });

  it("saving a new exercise untagged is allowed — the Add button is never gated on tags", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: "new-1" });
    const onSelect = vi.fn();
    render(<ExercisePicker exercises={EXERCISES} onSelect={onSelect} onCreate={onCreate} />);
    await user.type(screen.getByLabelText("Search exercises"), "Landmine Press");
    await user.click(screen.getByText('+ Add "Landmine Press" as a new exercise'));
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    expect(onCreate).toHaveBeenCalledWith("Landmine Press", [], []);
    expect(onSelect).toHaveBeenCalledWith({
      id: "new-1",
      name: "Landmine Press",
      primaryMuscles: [],
      secondaryMuscles: [],
    });
  });

  it("creating with muscle tags passes the selected primary and secondary groups", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: "new-2" });
    render(<ExercisePicker exercises={EXERCISES} onSelect={vi.fn()} onCreate={onCreate} />);
    await user.type(screen.getByLabelText("Search exercises"), "Landmine Press");
    await user.click(screen.getByText('+ Add "Landmine Press" as a new exercise'));
    await user.click(within(screen.getByTestId("muscle-group-primary")).getByText("Chest"));
    await user.click(within(screen.getByTestId("muscle-group-secondary")).getByText("Triceps"));
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    expect(onCreate).toHaveBeenCalledWith("Landmine Press", ["chest"], ["triceps"]);
  });
});
