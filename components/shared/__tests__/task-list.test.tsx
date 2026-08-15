import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskList } from "../task-list";

describe("TaskList", () => {
  it("shows a Done badge on a completed task", () => {
    render(
      <TaskList
        tasks={[
          { id: "t1", title: "Finish essay", dueDate: null, dueTime: null, completed: true },
          { id: "t2", title: "Read chapter", dueDate: null, dueTime: null, completed: false },
        ]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("does not show a Done badge when no task is completed", () => {
    render(
      <TaskList
        tasks={[{ id: "t1", title: "Finish essay", dueDate: null, dueTime: null, completed: false }]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("tints the completed checkbox with the passed accent, not a hardcoded school color", () => {
    render(
      <TaskList
        tasks={[{ id: "t1", title: "Bring snacks", dueDate: null, dueTime: null, completed: true }]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
        accent="coop"
      />
    );
    const checkbox = screen.getByRole("button", { name: "Mark incomplete" });
    expect(checkbox.className).toContain("border-accent-coop");
    expect(checkbox.className).not.toContain("border-accent-school");
  });

  it("defaults to the school accent when none is passed", () => {
    render(
      <TaskList
        tasks={[{ id: "t1", title: "Finish essay", dueDate: null, dueTime: null, completed: true }]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Mark incomplete" }).className).toContain(
      "border-accent-school"
    );
  });
});
