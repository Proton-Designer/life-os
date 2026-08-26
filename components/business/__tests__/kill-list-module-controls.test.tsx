import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KillListModuleControls } from "../kill-list-module-controls";
import type { KillListItemRow } from "@/app/(app)/business/kill-list-history-actions";

const { getKillListHistoryMock, toggleKillListItemMock } = vi.hoisted(() => ({
  getKillListHistoryMock: vi.fn(async () => [
    { label: "This week", days: [] },
    { label: "This month", days: [] },
    { label: "Past 3 months", days: [] },
  ]),
  toggleKillListItemMock: vi.fn(async () => {}),
}));

vi.mock("@/app/(app)/business/kill-list-history-actions", () => ({
  getKillListHistory: getKillListHistoryMock,
  getKillListDayDetail: vi.fn(async () => []),
}));
vi.mock("@/app/(app)/business/actions", () => ({
  toggleKillListItem: toggleKillListItemMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("KillListModuleControls", () => {
  beforeEach(() => {
    toggleKillListItemMock.mockClear();
  });

  it("shows 0 as a calm, deliberate count when there's nothing incomplete — the post-wipe launch state", () => {
    render(<KillListModuleControls initialIncompleteItems={[]} />);
    expect(screen.getByText("Incompleted this Week")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows the real count when items are incomplete", () => {
    const items: KillListItemRow[] = [
      { id: "a", text: "Finish deck", completed: false },
      { id: "b", text: "Call back", completed: false },
    ];
    render(<KillListModuleControls initialIncompleteItems={items} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("View opens the incomplete-items popup, and completing one removes it and decrements the badge", async () => {
    const items: KillListItemRow[] = [
      { id: "a", text: "Finish deck", completed: false },
      { id: "b", text: "Call back", completed: false },
    ];
    const user = userEvent.setup();
    render(<KillListModuleControls initialIncompleteItems={items} />);

    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText("Finish deck")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Mark "Finish deck" complete' }));
    expect(toggleKillListItemMock).toHaveBeenCalledWith("a");
    expect(screen.queryByText("Finish deck")).not.toBeInTheDocument();
    // Badge count decremented from 2 to 1.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("View More opens the full history dialog", async () => {
    const user = userEvent.setup();
    render(<KillListModuleControls initialIncompleteItems={[]} />);
    await user.click(screen.getByRole("button", { name: "View More" }));
    expect(await screen.findByText("Kill list history")).toBeInTheDocument();
  });
});
