import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HabitList } from "../habit-list";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const { castMock, retractMock } = vi.hoisted(() => ({ castMock: vi.fn(), retractMock: vi.fn() }));
vi.mock("@/app/(app)/habits/actions", () => ({
  castHabitVoteAction: castMock,
  retractHabitVoteAction: retractMock,
  createIdentityHabitAction: vi.fn(),
  pauseIdentityHabitAction: vi.fn(),
  resumeIdentityHabitAction: vi.fn(),
  refreshHabitViews: vi.fn(async () => {}),
}));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const habit = (id: string, statement: string) => ({
  id,
  identityStatement: statement,
  rank: 1,
  votedToday: false,
  isNew: false,
  score: 0.5,
  voteCount: 3,
});

describe("HabitList votes (PERF-2)", () => {
  beforeEach(() => {
    resetKeyedQueuesForTests();
    castMock.mockReset();
    retractMock.mockReset();
  });

  it("vote flips at once, never disables the button, and a quick second tap retracts in order", async () => {
    const first = deferred<{ ok: true }>();
    castMock.mockImplementationOnce(() => first.promise);
    retractMock.mockResolvedValue({ ok: true });
    render(<HabitList habits={[habit("h1", "A reader"), habit("h2", "A runner")]} pausedHabits={[]} today="2026-10-04" />);
    const user = userEvent.setup();
    const [vote1, vote2] = screen.getAllByRole("button", { name: "Vote for this identity today" });

    await user.click(vote1);
    const retract = screen.getByRole("button", { name: "Retract today's vote" });
    expect(retract).toBeEnabled();
    expect(vote2).toBeEnabled();
    await user.click(retract); // queued behind the in-flight cast
    expect(retractMock).not.toHaveBeenCalled();

    await act(async () => first.resolve({ ok: true }));
    await waitFor(() => expect(retractMock).toHaveBeenCalledWith("h1", "2026-10-04"));
    expect(castMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected vote reverts only that habit and shows the server's message", async () => {
    castMock.mockResolvedValue({ error: "Votes can only be cast or retracted for today." });
    render(<HabitList habits={[habit("h1", "A reader"), habit("h2", "A runner")]} pausedHabits={[]} today="2026-10-04" />);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Vote for this identity today" })[0]);
    await waitFor(() => expect(screen.getByText("Votes can only be cast or retracted for today.")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Vote for this identity today" })).toHaveLength(2);
  });
});

describe("HabitList faith practices (HABITS-02)", () => {
  const practice = { id: "p1", name: "Read Quran", anchorCue: null, committedDate: "2026-09-01", completedToday: false, stage: "locked" as const, stageOverride: null, rollingRate: { done: 20, total: 30 }, streak: 3 };

  it("shows the Faith practices block only when practices are passed (positive control)", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { HabitList } = await import("../habit-list");
    const { unmount } = render(<HabitList habits={[]} pausedHabits={[]} today="2026-10-05" />);
    expect(screen.queryByTestId("faith-practices")).not.toBeInTheDocument();
    unmount();
    render(<HabitList habits={[]} pausedHabits={[]} today="2026-10-05" faithPractices={[practice]} />);
    expect(screen.getByTestId("faith-practices")).toHaveTextContent("Read Quran");
  });
});
