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

const setDeenHabitLogStatus = vi.fn(async (..._a: unknown[]) => {});
const refreshFaithPracticeViews = vi.fn(async () => {});
vi.mock("@/app/(app)/deen/actions", () => ({
  setDeenHabitLogStatus: (...a: unknown[]) => setDeenHabitLogStatus(...a),
  refreshFaithPracticeViews: () => refreshFaithPracticeViews(),
}));

import { HabitCheckoffs } from "../habit-checkoffs";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { resetDeferredRefreshForTests } from "@/lib/client/deferred-refresh";
import type { HabitWithStatus } from "@/lib/habits/queries";
import { DAILY_FIELDS } from "@/lib/habits/__tests__/daily-fixture";

const habit = (over: Partial<HabitWithStatus> = {}): HabitWithStatus => ({
  id: "h1", identityStatement: "I am someone who reads daily", rank: 1, votedToday: false, isNew: false, score: 0.5, voteCount: 3, ...DAILY_FIELDS, streak: { count: 0, unit: "day" }, ...over,
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

  describe("faith practices", () => {
    const practice = (over = {}) => ({
      id: "p1", name: "Read Quran", anchorCue: "After Fajr", completedToday: false,
      stage: "active_build" as const, rollingRate: { done: 1, total: 3 },
      committedDate: "2026-09-20", stageOverride: null, streak: 0, streakInfo: { count: 0, unit: "day" as const }, ...DAILY_FIELDS, ...over,
    });

    it("lists identity habits, then practices with cue + Faith tag; panel shows for practices alone", () => {
      const { unmount } = render(<HabitCheckoffs habits={[habit()]} faithPractices={[practice()]} today="2026-10-05" />);
      const rows = screen.getAllByRole("checkbox");
      expect(rows[0]).toHaveTextContent("reads daily");
      expect(rows[1]).toHaveTextContent("Read Quran");
      expect(rows[1]).toHaveTextContent("After Fajr");
      expect(rows[1]).toHaveTextContent("Faith");
      expect(rows[0]).not.toHaveTextContent("Faith");
      unmount();
      render(<HabitCheckoffs habits={[]} faithPractices={[practice()]} today="2026-10-05" />);
      expect(screen.getByTestId("faith-practice-checkoff")).toBeInTheDocument();
    });

    it("no practices (Faith OFF) and no habits renders nothing", () => {
      const { container } = render(<HabitCheckoffs habits={[]} faithPractices={[]} today="2026-10-05" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("a tap flips at once and sends the ABSOLUTE (id, today, true), then false on untick", async () => {
      const user = userEvent.setup();
      render(<HabitCheckoffs habits={[]} faithPractices={[practice()]} today="2026-10-05" />);
      const row = screen.getByTestId("faith-practice-checkoff");
      await user.click(row);
      expect(row).toHaveAttribute("aria-checked", "true");
      await waitFor(() => expect(setDeenHabitLogStatus).toHaveBeenCalledWith("p1", "2026-10-05", true));
      await user.click(row);
      await waitFor(() => expect(setDeenHabitLogStatus).toHaveBeenLastCalledWith("p1", "2026-10-05", false));
      expect(cast).not.toHaveBeenCalled();
    });

    it("a failed write reverts and shows the error", async () => {
      setDeenHabitLogStatus.mockRejectedValueOnce(new Error("Faith is off"));
      const user = userEvent.setup();
      render(<HabitCheckoffs habits={[]} faithPractices={[practice()]} today="2026-10-05" />);
      await user.click(screen.getByTestId("faith-practice-checkoff"));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByTestId("faith-practice-checkoff")).toHaveAttribute("aria-checked", "false");
    });
  });
});

describe("HabitCheckoffs — only what is due today (HABIT-FREQ)", () => {
  const NOT_DUE = { due: false, doneToday: false, progress: null, nextDueDate: null, statusText: "Next: Wed" };

  it("a habit that isn't due today does not appear; one that is, does (positive control)", () => {
    render(
      <HabitCheckoffs
        habits={[
          habit({ id: "a", identityStatement: "I lift", frequency: { kind: "weekdays", days: [1, 3, 5] }, due: NOT_DUE }),
          habit({ id: "b", identityStatement: "I read" }),
        ]}
        today="2026-10-06"
      />
    );
    expect(screen.queryByRole("checkbox", { name: /I lift/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /I read/ })).toBeInTheDocument();
  });

  it("the panel disappears entirely when nothing is due", () => {
    const { container } = render(<HabitCheckoffs habits={[habit({ due: NOT_DUE })]} today="2026-10-06" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a not-due habit already ticked today stays, so the tick can be undone", () => {
    render(<HabitCheckoffs habits={[habit({ votedToday: true, due: NOT_DUE })]} today="2026-10-06" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("a flexible habit says where its period stands; a daily one says nothing extra", () => {
    render(
      <HabitCheckoffs
        habits={[
          habit({ id: "a", identityStatement: "I stretch", frequency: { kind: "per_week", count: 3 }, due: { due: true, doneToday: false, progress: { done: 1, target: 3, unit: "week" }, nextDueDate: null, statusText: "1 of 3 this week" } }),
          habit({ id: "b", identityStatement: "I read" }),
        ]}
        today="2026-10-06"
      />
    );
    const cadence = screen.getAllByTestId("habit-checkoff-cadence");
    expect(cadence).toHaveLength(1);
    expect(cadence[0]).toHaveTextContent("3× a week · 1 of 3 this week");
  });

  it("Faith practices follow the same rule", () => {
    const practice = (over: Record<string, unknown>) => ({
      id: "p", name: "Read Quran", anchorCue: null, completedToday: false, stage: "locked" as const, rollingRate: { done: 1, total: 2 },
      committedDate: "2026-09-20", stageOverride: null, streak: 0, streakInfo: { count: 0, unit: "day" as const }, ...DAILY_FIELDS, ...over,
    });
    render(<HabitCheckoffs habits={[]} faithPractices={[practice({ id: "x", name: "Fast Mondays", frequency: { kind: "weekdays", days: [1] }, due: NOT_DUE }), practice({ id: "y", name: "Dhikr" })]} today="2026-10-06" />);
    expect(screen.queryByText("Fast Mondays")).not.toBeInTheDocument();
    expect(screen.getByText("Dhikr")).toBeInTheDocument();
  });
});
