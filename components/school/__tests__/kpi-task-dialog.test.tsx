import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskRowItem } from "@/components/shared/task-row-list";
import { KpiTaskDialog } from "../kpi-task-dialog";

// A shipped bug (51bee86, 2026-08-24/25) rendered an empty list with NO
// all-clear message because every test that exercised it had active items
// present. These dialogs are opened at zero items constantly (an empty
// "Due today" is the COMMON case, not the edge case), so the empty state is
// asserted here explicitly, not left to be caught by chance.
describe("KpiTaskDialog", () => {
  async function openDialog(accessibleName: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: accessibleName }));
    return user;
  }

  it("shows the empty message, not a bare empty list, when there are zero items", async () => {
    render(
      <KpiTaskDialog title="Due today" items={[]} toggleTask={vi.fn()} emptyMessage="Nothing due today" />
    );
    await openDialog("View due today");
    expect(await screen.findByText("Nothing due today")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
  });

  it("lists items with their type/class meta and routes a tap to toggleTask", async () => {
    const toggleTask = vi.fn(() => Promise.resolve());
    const items: TaskRowItem[] = [
      { id: "t1", title: "Lab report", domain: "school", mode: "toggle", meta: "Assignment · PHYS-2326" },
    ];
    render(<KpiTaskDialog title="Overdue" items={items} toggleTask={toggleTask} emptyMessage="Nothing overdue" />);
    const user = await openDialog("View overdue");

    expect(screen.getByText("Lab report")).toBeInTheDocument();
    expect(screen.getByText("Assignment · PHYS-2326")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Mark "Lab report" done' }));
    expect(toggleTask).toHaveBeenCalledWith("t1");
  });

  // Batch 3 fix: three School KPI cards previously all shared the bare
  // accessible name "View" — indistinguishable from each other, and once
  // item 6b's class-card grid landed, from every card's own "View" button.
  it("gives each KPI's View trigger a distinct accessible name derived from its title, while keeping the visible label 'View'", () => {
    render(
      <KpiTaskDialog title="Due this week" items={[]} toggleTask={vi.fn()} emptyMessage="Nothing due this week" />
    );
    const button = screen.getByRole("button", { name: "View due this week" });
    expect(button).toHaveTextContent("View");
  });
});
