import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CompletedTasksDialog, type CompletedWeekGroup } from "../completed-tasks-dialog";

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Completed tasks" }));
  return user;
}

describe("CompletedTasksDialog", () => {
  it("shows an empty message when there are no completed weeks at all", async () => {
    render(<CompletedTasksDialog groups={[]} />);
    await open();
    expect(await screen.findByText("Nothing completed yet")).toBeInTheDocument();
  });

  it("shows a week section with zero items without erroring, collapsed by default", async () => {
    const groups: CompletedWeekGroup[] = [{ weekStart: "2026-08-16", weekLabel: "Week of Aug 16", items: [] }];
    render(<CompletedTasksDialog groups={groups} />);
    await open();

    const section = screen.getByRole("button", { name: /Week of Aug 16/ });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(section).toHaveTextContent("0 completed");
  });

  it("keeps every week collapsed by default, even the most recent", async () => {
    const groups: CompletedWeekGroup[] = [
      { weekStart: "2026-08-16", weekLabel: "Week of Aug 16", items: [{ id: "t1", title: "Essay", meta: "—" }] },
      { weekStart: "2026-08-09", weekLabel: "Week of Aug 9", items: [{ id: "t2", title: "Quiz", meta: "—" }] },
    ];
    render(<CompletedTasksDialog groups={groups} />);
    await open();

    expect(screen.getByRole("button", { name: /Week of Aug 16/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Week of Aug 9/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Essay")).not.toBeInTheDocument();
  });

  it("expands a section on click to reveal its items", async () => {
    const groups: CompletedWeekGroup[] = [
      { weekStart: "2026-08-16", weekLabel: "Week of Aug 16", items: [{ id: "t1", title: "Essay", meta: "Assignment · —" }] },
    ];
    render(<CompletedTasksDialog groups={groups} />);
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Week of Aug 16/ }));
    expect(screen.getByText("Essay")).toBeInTheDocument();
    expect(screen.getByText("Assignment · —")).toBeInTheDocument();
  });
});
