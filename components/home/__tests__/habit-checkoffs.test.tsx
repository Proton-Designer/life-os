import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cast = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
const retract = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { error: string }> => ({ ok: true }));
const refreshHabitViews = vi.fn(async () => {});
vi.mock("@/app/(app)/habits/actions", () => ({
  castHabitVoteAction: (...a: unknown[]) => cast(...a),
  retractHabitVoteAction: (...a: unknown[]) => retract(...a),
  refreshHabitViews: () => refreshHabitViews(),
}));

import { HabitCheckoffs } from "../habit-checkoffs";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { resetDeferredRefreshForTests } from "@/lib/client/deferred-refresh";
import type { HabitWithStatus } from "@/lib/habits/queries";

const habit = (over: Partial<HabitWithStatus> = {}): HabitWithStatus => ({
  id: "h1", identityStatement: "I am someone who reads daily", rank: 1, votedToday: false, isNew: false, score: 0.5, voteCount: 3, ...over,
});

describe("HabitCheckoffs (Home)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
    resetDeferredRefreshForTests();
  });

  it("renders nothing without habits (positive control: renders a row with one)", () => {
    const { container, unmount } = render(<HabitCheckoffs habits={[]} today="2026-10-05" />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<HabitCheckoffs habits={[habit()]} today="2026-10-05" />);
    expect(screen.getByRole("checkbox", { name: /reads daily/ })).toHaveAttribute("aria-checked", "false");
  });

  it("a tap flips at once and sends ONE absolute cast for today", async () => {
    const user = userEvent.setup();
    render(<HabitCheckoffs habits={[habit()]} today="2026-10-05" />);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(cast).toHaveBeenCalledWith("h1", "2026-10-05"));
    expect(retract).not.toHaveBeenCalled();
  });

  it("tapping a done habit retracts (absolute, not a flip); a rapid double tap lands in order, last wins", async () => {
    const user = userEvent.setup();
    render(<HabitCheckoffs habits={[habit({ votedToday: true })]} today="2026-10-05" />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(cast).toHaveBeenCalledTimes(1));
    expect(retract).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("a rejected write reverts the row and shows an alert", async () => {
    cast.mockResolvedValueOnce({ error: "Votes are today-only." });
    const user = userEvent.setup();
    render(<HabitCheckoffs habits={[habit()]} today="2026-10-05" />);
    await user.click(screen.getByRole("checkbox"));
    expect(await screen.findByRole("alert")).toHaveTextContent("today-only");
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });
});
