import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CompletedTasksDialog, type CompletedWeekGroup } from "../completed-tasks-dialog";

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

beforeEach(() => {
  refreshMock.mockClear();
});

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Completed tasks" }));
  return user;
}

describe("CompletedTasksDialog", () => {
  it("shows an empty message when there are no completed weeks at all", async () => {
    render(<CompletedTasksDialog groups={[]} removeTask={vi.fn()} />);
    await open();
    expect(await screen.findByText("Nothing completed yet")).toBeInTheDocument();
  });

  it("shows a week section with zero items without erroring, collapsed by default", async () => {
    const groups: CompletedWeekGroup[] = [{ weekStart: "2026-08-16", weekLabel: "Week of Aug 16", items: [] }];
    render(<CompletedTasksDialog groups={groups} removeTask={vi.fn()} />);
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
    render(<CompletedTasksDialog groups={groups} removeTask={vi.fn()} />);
    await open();

    expect(screen.getByRole("button", { name: /Week of Aug 16/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Week of Aug 9/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Essay")).not.toBeInTheDocument();
  });

  it("expands a section on click to reveal its items", async () => {
    const groups: CompletedWeekGroup[] = [
      { weekStart: "2026-08-16", weekLabel: "Week of Aug 16", items: [{ id: "t1", title: "Essay", meta: "Assignment · —" }] },
    ];
    render(<CompletedTasksDialog groups={groups} removeTask={vi.fn()} />);
    const user = await open();

    await user.click(screen.getByRole("button", { name: /Week of Aug 16/ }));
    expect(screen.getByText("Essay")).toBeInTheDocument();
    expect(screen.getByText("Assignment · —")).toBeInTheDocument();
  });

  // Opus Lead, 2026-08-26 (found during e2e triage): completed tasks had no
  // removal path anywhere in the app since the afternoon redesign scoped
  // the open-tasks list/edit components away from them — a real regression,
  // fixed here since this dialog is the one place a completed task is
  // actually visible.
  describe("remove", () => {
    const groups: CompletedWeekGroup[] = [
      {
        weekStart: "2026-08-16",
        weekLabel: "Week of Aug 16",
        items: [
          { id: "t1", title: "Essay", meta: "—" },
          { id: "t2", title: "Lab report", meta: "—" },
        ],
      },
    ];

    it("shows a per-item Remove control with a unique accessible name, only once expanded", async () => {
      render(<CompletedTasksDialog groups={groups} removeTask={vi.fn()} />);
      const user = await open();
      expect(screen.queryByRole("button", { name: "Remove Essay" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Week of Aug 16/ }));
      expect(screen.getByRole("button", { name: "Remove Essay" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove Lab report" })).toBeInTheDocument();
    });

    it("calls removeTask with the item's id and refreshes on success", async () => {
      const removeTask = vi.fn(() => Promise.resolve());
      render(<CompletedTasksDialog groups={groups} removeTask={removeTask} />);
      const user = await open();
      await user.click(screen.getByRole("button", { name: /Week of Aug 16/ }));

      await user.click(screen.getByRole("button", { name: "Remove Essay" }));
      expect(removeTask).toHaveBeenCalledWith("t1");
      await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("re-enables the control if removeTask rejects, instead of leaving it stuck disabled", async () => {
      const removeTask = vi.fn(() => Promise.reject(new Error("network")));
      render(<CompletedTasksDialog groups={groups} removeTask={removeTask} />);
      const user = await open();
      await user.click(screen.getByRole("button", { name: /Week of Aug 16/ }));

      const removeButton = screen.getByRole("button", { name: "Remove Essay" });
      await user.click(removeButton);
      await vi.waitFor(() => expect(removeButton).toBeEnabled());
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });
});
