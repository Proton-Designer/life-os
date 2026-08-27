import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IncompleteTasksModule } from "../incomplete-tasks-module";
import type { IncompleteByDateGroup } from "@/app/(app)/business/kill-list-history-actions";

const { toggleKillListItemMock } = vi.hoisted(() => ({
  toggleKillListItemMock: vi.fn(async () => {}),
}));

vi.mock("@/app/(app)/business/actions", () => ({
  toggleKillListItem: toggleKillListItemMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const GROUPS: IncompleteByDateGroup[] = [
  { date: "2026-08-26", items: [{ id: "a", text: "Finish deck", completed: false }] },
  {
    date: "2026-08-20",
    items: [
      { id: "b", text: "Call vendor", completed: false },
      { id: "c", text: "Send invoice", completed: false },
    ],
  },
];

// Item B3 (2026-08-26 night batch 3, verbatim): "in place of the lock in
// button add another module titled Incompleted Tasks with a count ... when
// teh user hits more, it should list by most recent date and list all the
// incompelted kill lists under each date."
describe("IncompleteTasksModule", () => {
  beforeEach(() => {
    toggleKillListItemMock.mockClear();
  });

  it("shows the total count across all date groups as the preview — count and nothing else", () => {
    render(<IncompleteTasksModule initialGroups={GROUPS} todayStr="2026-08-26" />);
    expect(screen.getByText("Incompleted Tasks")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // The item text itself must not leak into the collapsed preview.
    expect(screen.queryByText("Finish deck")).not.toBeInTheDocument();
  });

  it("shows a calm 0 and quiet caption when there's nothing outstanding", () => {
    render(<IncompleteTasksModule initialGroups={[]} todayStr="2026-08-26" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Nothing outstanding")).toBeInTheDocument();
  });

  it("More opens a dialog listing every date group, most recent first, with formatted dates", async () => {
    const user = userEvent.setup();
    render(<IncompleteTasksModule initialGroups={GROUPS} todayStr="2026-08-26" />);
    await user.click(screen.getByRole("button", { name: "More" }));

    expect(await screen.findByText("Call vendor")).toBeInTheDocument();
    expect(screen.getByText("Send invoice")).toBeInTheDocument();
    expect(screen.getByText("Finish deck")).toBeInTheDocument();
    expect(screen.getByText("Aug. 26th")).toBeInTheDocument();
    expect(screen.getByText("Aug. 20th")).toBeInTheDocument();
  });

  it("completing an item in the dialog removes it, decrements the preview count, and drops an emptied date entirely", async () => {
    const user = userEvent.setup();
    render(<IncompleteTasksModule initialGroups={GROUPS} todayStr="2026-08-26" />);
    await user.click(screen.getByRole("button", { name: "More" }));

    await user.click(await screen.findByRole("button", { name: 'Mark "Finish deck" complete' }));
    expect(toggleKillListItemMock).toHaveBeenCalledWith("a");
    expect(screen.queryByText("Finish deck")).not.toBeInTheDocument();
    // 2026-08-26 had exactly this one item — its date header goes with it.
    expect(screen.queryByText("Aug. 26th")).not.toBeInTheDocument();
    // Preview count decremented from 3 to 2, visible behind the open dialog.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
