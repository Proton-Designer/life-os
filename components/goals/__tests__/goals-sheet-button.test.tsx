import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getGoalsSheetData = vi.fn();
vi.mock("@/app/(app)/goals/actions", () => ({ getGoalsSheetData: () => getGoalsSheetData() }));
vi.mock("@/components/goals/goal-board", () => ({
  GoalBoard: ({ goals }: { goals: { title: string }[] }) => <div data-testid="board">{goals.map((g) => g.title).join(",")}</div>,
}));

import { GoalsSheetButton } from "../goals-sheet-button";

describe("GoalsSheetButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads nothing until opened, then shows the board with the fetched data", async () => {
    getGoalsSheetData.mockResolvedValue({ deenMode: false, reservedRanks: [], monthStart: "2026-10-01", todayStr: "2026-10-05", goals: [{ title: "Run a 10k" }], milestones: [] });
    const user = userEvent.setup();
    render(<GoalsSheetButton />);
    expect(getGoalsSheetData).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("goals-sheet-open"));
    expect(await screen.findByTestId("board")).toHaveTextContent("Run a 10k");
    expect(getGoalsSheetData).toHaveBeenCalledTimes(1);
  });

  it("a failed read shows an alert instead of an empty board", async () => {
    getGoalsSheetData.mockRejectedValue(new Error("x"));
    const user = userEvent.setup();
    render(<GoalsSheetButton />);
    await user.click(screen.getByTestId("goals-sheet-open"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your goals");
    expect(screen.queryByTestId("board")).not.toBeInTheDocument();
  });
});
