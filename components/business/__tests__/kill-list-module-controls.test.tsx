import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { KillListModuleControls } from "../kill-list-module-controls";

const { getKillListHistoryMock } = vi.hoisted(() => ({
  getKillListHistoryMock: vi.fn(async () => [
    { label: "This week", days: [] },
    { label: "This month", days: [] },
    { label: "Past 3 months", days: [] },
  ]),
}));

vi.mock("@/app/(app)/business/kill-list-history-actions", () => ({
  getKillListHistory: getKillListHistoryMock,
  getKillListDayDetail: vi.fn(async () => []),
}));
// KillListHistoryDialog renders KillListItemsDialog (for its day-detail
// popup) unconditionally, which calls useRouter() even while closed.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// The "Incompleted this Week" count/list this component used to carry
// (item B3-3) was promoted into its own module (2026-08-26 night batch 3) —
// see incomplete-tasks-module.test.tsx for that coverage now.
describe("KillListModuleControls", () => {
  it("View More opens the full history dialog", async () => {
    const user = userEvent.setup();
    render(<KillListModuleControls />);
    await user.click(screen.getByRole("button", { name: "View More" }));
    expect(await screen.findByText("Kill list history")).toBeInTheDocument();
  });
});
