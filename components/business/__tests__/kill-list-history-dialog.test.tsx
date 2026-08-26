import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KillListHistoryDialog } from "../kill-list-history-dialog";
import type { KillListGroup, KillListItemRow } from "@/app/(app)/business/kill-list-history-actions";

const { getKillListHistoryMock, getKillListDayDetailMock, toggleKillListItemMock } = vi.hoisted(() => ({
  getKillListHistoryMock: vi.fn(),
  getKillListDayDetailMock: vi.fn(),
  toggleKillListItemMock: vi.fn(async () => {}),
}));

vi.mock("@/app/(app)/business/kill-list-history-actions", () => ({
  getKillListHistory: getKillListHistoryMock,
  getKillListDayDetail: getKillListDayDetailMock,
}));
vi.mock("@/app/(app)/business/actions", () => ({
  toggleKillListItem: toggleKillListItemMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const EMPTY_GROUPS: KillListGroup[] = [
  { label: "This week", days: [] },
  { label: "This month", days: [] },
  { label: "Past 3 months", days: [] },
];

describe("KillListHistoryDialog", () => {
  beforeEach(() => {
    getKillListHistoryMock.mockReset();
    getKillListDayDetailMock.mockReset();
    toggleKillListItemMock.mockClear();
  });

  // The launch state, not an edge case: after tonight's wipe there is no
  // kill-list history at all (Opus Lead).
  it("renders a calm, deliberate empty state with zero history — not a crash, not a blank screen", async () => {
    getKillListHistoryMock.mockResolvedValue(EMPTY_GROUPS);
    render(<KillListHistoryDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("No past kill list history yet.")).toBeInTheDocument();
  });

  it("renders each group's days with a completed/total ring", async () => {
    getKillListHistoryMock.mockResolvedValue([
      { label: "This week", days: [{ date: "2026-08-24", completed: 2, total: 3 }] },
      { label: "This month", days: [] },
      { label: "Past 3 months", days: [] },
    ]);
    render(<KillListHistoryDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText("2026-08-24")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("opens a day's items and lets the user toggle one", async () => {
    getKillListHistoryMock.mockResolvedValue([
      { label: "This week", days: [{ date: "2026-08-24", completed: 1, total: 2 }] },
      { label: "This month", days: [] },
      { label: "Past 3 months", days: [] },
    ]);
    const items: KillListItemRow[] = [
      { id: "a", text: "Ship it", completed: true },
      { id: "b", text: "Call back", completed: false },
    ];
    getKillListDayDetailMock.mockResolvedValue(items);
    const user = userEvent.setup();
    render(<KillListHistoryDialog open onOpenChange={vi.fn()} />);

    await user.click(await screen.findByText("2026-08-24"));
    expect(await screen.findByText("Call back")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Mark "Call back" complete' }));
    expect(toggleKillListItemMock).toHaveBeenCalledWith("b");
  });
});
