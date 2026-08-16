import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeadlineList } from "../deadline-list";

describe("DeadlineList", () => {
  it("shows an EmptyState with a real action when there are no deadlines", () => {
    render(<DeadlineList tasks={[]} todayStr="2026-08-15" toggleTask={vi.fn()} />);
    expect(screen.getByText("Nothing due yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a task" })).toBeInTheDocument();
  });

  it("sorts tasks soonest-due first regardless of input order", () => {
    render(
      <DeadlineList
        tasks={[
          { id: "b", title: "Later task", dueDate: "2026-08-20", dueTime: null },
          { id: "a", title: "Sooner task", dueDate: "2026-08-16", dueTime: null },
        ]}
        todayStr="2026-08-15"
        toggleTask={vi.fn()}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Sooner task");
    expect(items[1]).toHaveTextContent("Later task");
  });

  it("labels an overdue task and calls toggleTask on click", async () => {
    const user = userEvent.setup();
    const toggleTask = vi.fn();
    render(
      <DeadlineList
        tasks={[{ id: "a", title: "Late task", dueDate: "2026-08-10", dueTime: null }]}
        todayStr="2026-08-15"
        toggleTask={toggleTask}
      />
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(toggleTask).toHaveBeenCalledWith("a");
  });
});
