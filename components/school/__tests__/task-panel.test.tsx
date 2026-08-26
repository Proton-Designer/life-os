import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { SchoolTaskPanel } from "../task-panel";

// SchoolTaskPanel is the "use client" wrapper TaskRowList's own doc comment
// requires — Server Actions imported and called here, plain data in from
// page.tsx. This file covers the wiring (add/complete/remove routed to the
// right action, add form independent of TaskRowList's own contract), not
// TaskRowList's own row/animation behavior (see task-row-list.test.tsx).
describe("SchoolTaskPanel", () => {
  function item(overrides: Partial<TaskRowItem> & Pick<TaskRowItem, "id" | "title">): TaskRowItem {
    return { domain: "school", mode: "toggle", ...overrides };
  }

  it("renders each active item's title and meta (due date)", () => {
    render(
      <SchoolTaskPanel
        items={[item({ id: "t1", title: "Finish essay", meta: "2026-08-30" })]}
        classOptions={[]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    expect(screen.getByText("Finish essay")).toBeInTheDocument();
    expect(screen.getByText("2026-08-30")).toBeInTheDocument();
  });

  it("routes a tap-to-complete to toggleTask with the item's id", async () => {
    const toggleTask = vi.fn(() => Promise.resolve());
    render(
      <SchoolTaskPanel
        items={[item({ id: "t1", title: "Finish essay" })]}
        classOptions={[]}
        addTask={vi.fn()}
        toggleTask={toggleTask}
        removeTask={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: 'Mark "Finish essay" done' }));
    expect(toggleTask).toHaveBeenCalledWith("t1");
  });

  it("routes Remove to removeTask with the item's id", async () => {
    const removeTask = vi.fn(() => Promise.resolve());
    render(
      <SchoolTaskPanel
        items={[item({ id: "t1", title: "Finish essay" })]}
        classOptions={[]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={removeTask}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove Finish essay" }));
    expect(removeTask).toHaveBeenCalledWith("t1");
  });

  it("shows a Remove control on a completed item too (parity with the old TaskList)", async () => {
    render(
      <SchoolTaskPanel
        items={[item({ id: "t1", title: "Finish essay", completedAtIso: "2026-08-24T12:00:00.000Z" })]}
        classOptions={[]}
        addTask={vi.fn()}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    // Completed section is collapsed by default.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: "Remove Finish essay" })).toBeInTheDocument();
  });

  it("submits a new task via addTask and clears the form, independent of TaskRowList's own items", async () => {
    const addTask = vi.fn(() => Promise.resolve());
    render(<SchoolTaskPanel items={[]} classOptions={[]} addTask={addTask} toggleTask={vi.fn()} removeTask={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Add a task"), "Read chapter 4");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(addTask).toHaveBeenCalledWith("Read chapter 4", undefined, undefined, undefined, undefined);
    expect(screen.getByPlaceholderText("Add a task")).toHaveValue("");
  });

  it("does not submit a blank task", async () => {
    const addTask = vi.fn(() => Promise.resolve());
    render(<SchoolTaskPanel items={[]} classOptions={[]} addTask={addTask} toggleTask={vi.fn()} removeTask={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(addTask).not.toHaveBeenCalled();
  });

  it("passes the selected type and class through to addTask", async () => {
    const addTask = vi.fn(() => Promise.resolve());
    render(
      <SchoolTaskPanel
        items={[]}
        classOptions={[{ id: "event-1", title: "PHYS-2326" }]}
        addTask={addTask}
        toggleTask={vi.fn()}
        removeTask={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Add a task"), "Lab report");
    await user.selectOptions(screen.getByLabelText("Type"), "reading");
    await user.selectOptions(screen.getByLabelText("Class"), "event-1");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(addTask).toHaveBeenCalledWith("Lab report", undefined, undefined, "reading", "event-1");
  });
});
