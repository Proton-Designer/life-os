import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskListModule, type TaskListItem } from "../task-list-module";

const CLASSES = [{ id: "c1", label: "PHYS-2326-002" }];
const TODAY = "2026-08-25";
const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];
const NEXT_WEEK_SUNDAY = "2026-08-30";
const NEXT_WEEK_FRIDAY = "2026-09-04";

function task(overrides: Partial<TaskListItem> & Pick<TaskListItem, "id" | "title" | "dueDate">): TaskListItem {
  return { taskType: "homework_assignment", taskTypeOtherLabel: null, classId: null, className: null, ...overrides };
}

describe("TaskListModule", () => {
  it("expands Due Soon by default and keeps the other groups collapsed", () => {
    render(
      <TaskListModule
        tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Due Soon/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Upcoming/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Future/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });

  // Ayman, 2026-09-10: "overdue items still remain present in the task
  // list, make sure that they are auto removed and just show in the
  // overdue section" (the School screen's Overdue KPI card, not this
  // module — see lib/tasks/task-groups.ts's TASK_GROUP_ORDER comment).
  it("auto-removes an overdue task from the list entirely — it renders in no group", async () => {
    render(
      <TaskListModule
        tasks={[
          task({ id: "t1", title: "Overdue paper", dueDate: "2026-08-20" }),
          task({ id: "t2", title: "Due today", dueDate: TODAY }),
        ]}
        classes={CLASSES}
        todayStr={TODAY}
        weekDates={WEEK_DATES}
        toggleTask={vi.fn()}
      />
    );
    // Due Soon is expanded by default, so if the overdue task were still in
    // that bucket it would be visible here.
    expect(screen.getByRole("button", { name: /Due Soon/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Overdue paper")).not.toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();

    // Expand every other group too — an overdue task hiding in Upcoming
    // or Future (rather than genuinely nowhere) would be just as wrong.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Upcoming/ }));
    await user.click(screen.getByRole("button", { name: /Future/ }));
    expect(screen.queryByText("Overdue paper")).not.toBeInTheDocument();
  });

  it("no longer renders a top-level Today group, a This Week one, or a This Month/Next Month one", () => {
    render(
      <TaskListModule tasks={[]} classes={CLASSES} todayStr={TODAY} weekDates={WEEK_DATES} toggleTask={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /^Today/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^This Week/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /This Month/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next Month/ })).not.toBeInTheDocument();
  });

  it("lets Due Soon be collapsed and re-expanded like any other group", async () => {
    render(
      <TaskListModule tasks={[]} classes={CLASSES} todayStr={TODAY} weekDates={WEEK_DATES} toggleTask={vi.fn()} />
    );
    const user = userEvent.setup();
    const dueSoonButton = screen.getByRole("button", { name: /Due Soon/ });
    await user.click(dueSoonButton);
    expect(dueSoonButton).toHaveAttribute("aria-expanded", "false");
    await user.click(dueSoonButton);
    expect(dueSoonButton).toHaveAttribute("aria-expanded", "true");
  });

  describe("Due Soon's This week / Next week split", () => {
    it("puts this week's work under This week and next week's work under Next week, both under Due Soon", async () => {
      render(
        <TaskListModule
          tasks={[
            task({ id: "t1", title: "Due today", dueDate: TODAY }),
            task({ id: "t2", title: "Due Saturday", dueDate: "2026-08-29" }),
            task({ id: "t3", title: "Due next Sunday", dueDate: NEXT_WEEK_SUNDAY }),
            task({ id: "t4", title: "Due next Friday", dueDate: NEXT_WEEK_FRIDAY }),
          ]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      expect(screen.getByRole("button", { name: /This week/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Due today")).toBeInTheDocument();
      expect(screen.getByText("Due Saturday")).toBeInTheDocument();
      // SCHOOL-02: Next week is EXPANDED by default too, and can still be collapsed (positive control: collapsing hides it).
      expect(screen.getByRole("button", { name: /Next week/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Due next Sunday")).toBeInTheDocument();
      expect(screen.getByText("Due next Friday")).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Next week/ }));
      expect(screen.queryByText("Due next Sunday")).not.toBeInTheDocument();
    });

    it("orders This week above Next week, top to bottom", () => {
      const { container } = render(
        <TaskListModule
          tasks={[
            task({ id: "t1", title: "Next week task", dueDate: NEXT_WEEK_SUNDAY }),
            task({ id: "t2", title: "This week task", dueDate: TODAY }),
          ]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      const headers = Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "");
      const thisWeekIdx = headers.findIndex((h) => h.startsWith("This week"));
      const nextWeekIdx = headers.findIndex((h) => h.startsWith("Next week"));
      expect(thisWeekIdx).toBeGreaterThanOrEqual(0);
      expect(nextWeekIdx).toBeGreaterThan(thisWeekIdx);
    });

    it("counts the whole two-week range in the Due Soon header", () => {
      render(
        <TaskListModule
          tasks={[
            task({ id: "t1", title: "Due today", dueDate: TODAY }),
            task({ id: "t2", title: "Due next week", dueDate: NEXT_WEEK_SUNDAY }),
          ]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      expect(screen.getByRole("button", { name: /Due Soon.*2/ })).toBeInTheDocument();
    });

    it("renders no This week header when nothing is due this week, even if next week has work", () => {
      render(
        <TaskListModule
          tasks={[task({ id: "t1", title: "Due next week", dueDate: NEXT_WEEK_SUNDAY })]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /This week/ })).not.toBeInTheDocument();
    });

    it("renders no Next week header when nothing is due next week", () => {
      render(
        <TaskListModule
          tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /Next week/ })).not.toBeInTheDocument();
    });

    it("This week can be collapsed independently of Due Soon", async () => {
      render(
        <TaskListModule
          tasks={[task({ id: "t1", title: "Due today", dueDate: TODAY })]}
          classes={CLASSES}
          todayStr={TODAY}
          weekDates={WEEK_DATES}
          toggleTask={vi.fn()}
        />
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /This week/ }));
      expect(screen.queryByText("Due today")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Due Soon/ })).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("filtering narrows results without auto-expanding collapsed groups", async () => {
    render(
      <TaskListModule
        // #51 fix (2026-09-14): the Upcoming window widened to a real, constant 30 days
        // (was 19 for this specific TODAY under the old weekday-dependent formula), so
        // this date has to sit further out to stay genuinely beyond the horizon.
        tasks={[task({ id: "t1", title: "Future homework", dueDate: "2026-11-01" })]}
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
    // Due Soon starts expanded, and today's task sits in its This week head.
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
