import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClassAssessments, type ClassAssessment } from "../class-assessments";

// Batch 3 (2026-08-26 afternoon) rewrite: ClassAssessments no longer talks
// to the server or holds its own list — it's a pure staged-state renderer,
// so these tests exercise the onAdd/onUpdate/onRemove contract directly
// rather than mocking class-actions.

function assessment(overrides: Partial<ClassAssessment> = {}): ClassAssessment {
  return { id: "a1", name: "Midterm", type: "midterm_final", date: "2026-10-06", task_id: "t1", ...overrides };
}

describe("ClassAssessments", () => {
  it("renders rows read-only when not editing, but Add is still available (Add isn't staged)", () => {
    render(
      <ClassAssessments
        assessments={[assessment()]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Midterm")).toBeInTheDocument();
    expect(screen.getByText("Midterm/Final")).toBeInTheDocument();
    // Rendered through formatShortDate, never the raw ISO string.
    expect(screen.getByText("Oct. 6th")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-06")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add assessment" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the empty message when there are zero assessments", () => {
    render(
      <ClassAssessments
        assessments={[]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("No assessments yet.")).toBeInTheDocument();
  });

  it("shows the Add button and inline-editable fields once editing, and Remove calls onRemove", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments
        assessments={[assessment()]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />
    );
    expect(screen.getByRole("button", { name: "Add assessment" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name for Midterm" })).toHaveValue("Midterm");

    await user.click(screen.getByRole("button", { name: "Remove Midterm" }));
    expect(onRemove).toHaveBeenCalledWith("a1");
  });

  it("editing the inline name field calls onUpdate with the patch, not a full row replace", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments
        assessments={[assessment({ name: "Q" })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );
    await user.type(screen.getByRole("textbox", { name: "Name for Q" }), "!");
    expect(onUpdate).toHaveBeenCalledWith("a1", { name: "Q!" });
  });

  it("Add asks type first, then name+date, and stages via onAdd rather than calling the server", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassAssessments assessments={[]} editing todayStr="2026-08-26" onAdd={onAdd} onUpdate={vi.fn()} onRemove={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "Add assessment" }));
    expect(screen.getByText("Assessment type")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quiz" }));
    expect(screen.getByText("Quiz details")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Name"), "Reading check");
    const dateInputs = screen.getAllByDisplayValue("");
    await user.type(dateInputs[0], "2026-09-15");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledWith({ name: "Reading check", type: "quiz", date: "2026-09-15" });
    // The type/details forms are gone again once submitted.
    expect(screen.queryByText("Quiz details")).not.toBeInTheDocument();
  });

  it("shows the linked-task removal note only while editing and only when a row has a task_id", () => {
    const { rerender } = render(
      <ClassAssessments
        assessments={[assessment({ task_id: "t1" })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Removing an assessment also removes its linked task.")).toBeInTheDocument();

    rerender(
      <ClassAssessments
        assessments={[assessment({ task_id: "t1" })]}
        editing={false}
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByText("Removing an assessment also removes its linked task.")).not.toBeInTheDocument();

    rerender(
      <ClassAssessments
        assessments={[assessment({ task_id: null })]}
        editing
        todayStr="2026-08-26"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.queryByText("Removing an assessment also removes its linked task.")).not.toBeInTheDocument();
  });
});
