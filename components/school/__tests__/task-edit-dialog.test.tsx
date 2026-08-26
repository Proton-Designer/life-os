import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskEditDialog } from "../task-edit-dialog";
import type { TaskListItem } from "../task-list-module";

const CLASSES = [{ id: "c1", label: "PHYS-2326-002" }];

function task(overrides: Partial<TaskListItem> & Pick<TaskListItem, "id" | "title">): TaskListItem {
  return {
    dueDate: "2026-08-25",
    taskType: "homework_assignment",
    taskTypeOtherLabel: null,
    classId: null,
    className: null,
    ...overrides,
  };
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  return user;
}

describe("TaskEditDialog", () => {
  it("shows an empty message when there are no tasks", async () => {
    render(<TaskEditDialog tasks={[]} classes={CLASSES} updateTask={vi.fn()} removeTask={vi.fn()} />);
    await open();
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
  });

  it("removes a task by its id", async () => {
    const removeTask = vi.fn(() => Promise.resolve());
    render(
      <TaskEditDialog
        tasks={[task({ id: "t1", title: "Lab report" })]}
        classes={CLASSES}
        updateTask={vi.fn()}
        removeTask={removeTask}
      />
    );
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Remove Lab report" }));
    expect(removeTask).toHaveBeenCalledWith("t1");
  });

  it("edits a task's title, type, class, and date, submitting the full replacement", async () => {
    const updateTask = vi.fn(() => Promise.resolve());
    render(
      <TaskEditDialog
        tasks={[task({ id: "t1", title: "Lab report", taskType: "homework_assignment" })]}
        classes={CLASSES}
        updateTask={updateTask}
        removeTask={vi.fn()}
      />
    );
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Edit Lab report" }));

    const titleInput = screen.getByDisplayValue("Lab report");
    await user.clear(titleInput);
    await user.type(titleInput, "Lab report v2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTask).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ title: "Lab report v2", taskType: "homework_assignment", dueDate: "2026-08-25" })
    );
  });

  it("rejects saving without a description", async () => {
    const updateTask = vi.fn(() => Promise.resolve());
    render(
      <TaskEditDialog
        tasks={[task({ id: "t1", title: "Lab report" })]}
        classes={CLASSES}
        updateTask={updateTask}
        removeTask={vi.fn()}
      />
    );
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Edit Lab report" }));
    await user.clear(screen.getByDisplayValue("Lab report"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a description")).toBeInTheDocument();
  });

  it("cancels an in-progress edit without saving", async () => {
    const updateTask = vi.fn(() => Promise.resolve());
    render(
      <TaskEditDialog
        tasks={[task({ id: "t1", title: "Lab report" })]}
        classes={CLASSES}
        updateTask={updateTask}
        removeTask={vi.fn()}
      />
    );
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Edit Lab report" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.getByText("Lab report")).toBeInTheDocument();
  });
});
