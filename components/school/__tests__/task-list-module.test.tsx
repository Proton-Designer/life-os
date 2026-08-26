import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskListModule, type TaskListItem } from "../task-list-module";

const CLASSES = [{ id: "c1", label: "PHYS-2326-002" }];
const TODAY = "2026-08-25";
const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

function task(overrides: Partial<TaskListItem> & Pick<TaskListItem, "id" | "title" | "dueDate">): TaskListItem {
  return { taskType: "homework_assignment", taskTypeOtherLabel: null, classId: null, className: null, ...overrides };
}

describe("TaskListModule", () => {
  it("expands Today by default and keeps the other three groups collapsed", () => {
    render(
      <TaskListModule
        tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /This Week/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /This Month/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Future/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });

  it("lets Today be collapsed and re-expanded like any other group", async () => {
    render(
      <TaskListModule tasks={[]} classes={CLASSES} todayStr={TODAY} weekDates={WEEK_DATES} toggleTask={vi.fn()} />
    );
    const user = userEvent.setup();
    const todayButton = screen.getByRole("button", { name: /Today/ });
    await user.click(todayButton);
    expect(todayButton).toHaveAttribute("aria-expanded", "false");
    await user.click(todayButton);
    expect(todayButton).toHaveAttribute("aria-expanded", "true");
  });

  it("filtering narrows results without auto-expanding collapsed groups", async () => {
    render(
      <TaskListModule
        tasks={[task({ id: "t1", title: "Future homework", dueDate: "2026-10-01" })]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Filter by type"), "homework_assignment");

    // The match lives in Future, which must stay collapsed despite matching a filter.
    expect(screen.getByRole("button", { name: /Future/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Future homework")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Future/ }));
    expect(screen.getByText("Future homework")).toBeInTheDocument();
  });

  it("shows a Deselect filters button only once a filter is active, and it clears all three", async () => {
    render(
      <TaskListModule tasks={[]} classes={CLASSES} todayStr={TODAY} weekDates={WEEK_DATES} toggleTask={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Deselect filters" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Filter by class"), "c1");
    expect(await screen.findByRole("button", { name: "Deselect filters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deselect filters" }));
    expect(screen.queryByRole("button", { name: "Deselect filters" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter by class")).toHaveValue("");
  });

  it("routes a tap-to-complete to toggleTask with the item's id", async () => {
    const toggleTask = vi.fn(() => Promise.resolve());
    render(
      <TaskListModule
        tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={toggleTask}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: 'Mark "Due today" done' }));
    expect(toggleTask).toHaveBeenCalledWith("t1");
  });

  // C4: dates must never render raw.
  it("shows the formatted date, not the raw ISO string", async () => {
    render(
      <TaskListModule
        tasks={[task({ id: "t1", title: "Paper due", dueDate: TODAY })]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    // "Today" starts expanded — dueDate === todayStr lands it there.
    expect(screen.getByText("Aug. 25th")).toBeInTheDocument();
    expect(screen.queryByText(TODAY)).not.toBeInTheDocument();
  });

  // C4/R7: a class-scoped list (every task already belongs to one class)
  // must not also show a redundant "All classes" filter.
  it("hides the class filter when hideClassFilter is set, keeping type and date filters", () => {
    render(
      <TaskListModule
        tasks={[]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
        hideClassFilter
      />
    );
    expect(screen.queryByLabelText("Filter by class")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter by type")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by date")).toBeInTheDocument();
  });

  // C3: this component holds no staged state — editing is dumb and the
  // caller supplies onEditTask/onRemoveTask plus already-staged `tasks`.
  describe("editing mode", () => {
    it("makes tap-to-complete inert while editing", async () => {
      const toggleTask = vi.fn(() => Promise.resolve());
      render(
        <TaskListModule
          tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={toggleTask}
          editing
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: 'Mark "Due today" done' }));
      expect(toggleTask).not.toHaveBeenCalled();
    });

    it("shows per-row Edit/Remove controls with unique accessible names and routes them to the callbacks", async () => {
      const onEditTask = vi.fn();
      const onRemoveTask = vi.fn();
      render(
        <TaskListModule
          tasks={[
            task({ id: "t1", title: "Midterm Exam", dueDate: TODAY }),
            task({ id: "t2", title: "Lab report", dueDate: TODAY }),
          ]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
          editing
          onEditTask={onEditTask}
          onRemoveTask={onRemoveTask}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit Midterm Exam" }));
      expect(onEditTask).toHaveBeenCalledWith("t1");
      await user.click(screen.getByRole("button", { name: "Remove Lab report" }));
      expect(onRemoveTask).toHaveBeenCalledWith("t2");
    });

    it("shows no Edit/Remove controls when editing is false", () => {
      render(
        <TaskListModule
          tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: "Edit Due today" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove Due today" })).not.toBeInTheDocument();
    });
  });

  it("colors each task type distinctly while still showing the type as a label", () => {
    render(
      <TaskListModule
        tasks={[
          task({ id: "t1", title: "HW", dueDate: TODAY, taskType: "homework_assignment" }),
          task({ id: "t2", title: "Quiz", dueDate: TODAY, taskType: "quiz" }),
        ]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    const hw = screen.getAllByText("Homework/Assignment").find((el) => el.tagName === "SPAN")!;
    const quiz = screen.getAllByText("Quiz").find((el) => el.tagName === "SPAN")!;
    expect(hw.className).not.toBe(quiz.className);
  });
});
