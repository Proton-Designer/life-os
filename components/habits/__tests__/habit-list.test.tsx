import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HabitList } from "../habit-list";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { DAILY_FIELDS } from "@/lib/habits/__tests__/daily-fixture";

const { castMock, retractMock, createMock, setFrequencyMock } = vi.hoisted(() => ({ castMock: vi.fn(), retractMock: vi.fn(), createMock: vi.fn(), setFrequencyMock: vi.fn() }));
vi.mock("@/app/(app)/habits/actions", () => ({
  castHabitVoteAction: castMock,
  retractHabitVoteAction: retractMock,
  createIdentityHabitAction: createMock,
  setIdentityHabitFrequencyAction: setFrequencyMock,
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
  ...DAILY_FIELDS,
  streak: { count: 0, unit: "day" as const },
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
  const practice = { id: "p1", name: "Read Quran", anchorCue: null, committedDate: "2026-09-01", completedToday: false, stage: "locked" as const, stageOverride: null, rollingRate: { done: 20, total: 30 }, streak: 3, streakInfo: { count: 3, unit: "day" as const }, ...DAILY_FIELDS };

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

describe("HabitList — cadence (HABIT-FREQ)", () => {
  const weekly = (over: Record<string, unknown> = {}) => ({
    ...habit("h1", "A reader"),
    frequency: { kind: "per_week" as const, count: 3 },
    due: { due: true, doneToday: false, progress: { done: 1, target: 3, unit: "week" as const }, nextDueDate: null, statusText: "1 of 3 this week" },
    streak: { count: 2, unit: "week" as const },
    ...over,
  });

  beforeEach(() => {
    resetKeyedQueuesForTests();
    createMock.mockReset();
    setFrequencyMock.mockReset();
  });

  it("a daily habit shows no cadence line; a '3× a week' one shows cadence, progress and its week streak", () => {
    const { unmount } = render(<HabitList habits={[habit("h1", "A reader")]} pausedHabits={[]} today="2026-10-07" />);
    expect(screen.queryByTestId("habit-cadence")).not.toBeInTheDocument();
    unmount();
    render(<HabitList habits={[weekly()]} pausedHabits={[]} today="2026-10-07" />);
    expect(screen.getByTestId("habit-cadence")).toHaveTextContent("3× a week · 1 of 3 this week · 2 wk streak");
  });

  it("a habit that isn't due today is dimmed, but its vote button still works", () => {
    render(<HabitList habits={[weekly({ due: { due: false, doneToday: false, progress: { done: 3, target: 3, unit: "week" }, nextDueDate: null, statusText: "Done for this week" } })]} pausedHabits={[]} today="2026-10-07" />);
    expect(screen.getByTestId("habit-cadence").closest("li")!.className).toContain("opacity-70");
    expect(screen.getByRole("button", { name: "Vote for this identity today" })).toBeEnabled();
  });

  it("adding a habit sends the chosen cadence and the new row reflects it at once", async () => {
    createMock.mockResolvedValue({ ok: true, habit: { id: "n1", identityStatement: "the writer", rank: 1, createdAt: "x", frequency: { kind: "weekdays", days: [1, 3, 5] } } });
    const user = userEvent.setup();
    render(<HabitList habits={[]} pausedHabits={[]} today="2026-10-07" />); // a Wednesday
    await user.click(screen.getByRole("button", { name: "+ Add an identity habit" }));
    await user.type(screen.getByPlaceholderText(/Identity statement/), "the writer");
    await user.click(screen.getByRole("radio", { name: "Certain days" }));
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createMock).toHaveBeenCalledWith("the writer", { kind: "weekdays", days: [1, 3, 5] });
    expect(await screen.findByTestId("habit-cadence")).toHaveTextContent("Mon · Wed · Fri");
  });

  it("an untouched picker adds a plain daily habit, exactly as before", async () => {
    createMock.mockResolvedValue({ ok: true, habit: { id: "n1", identityStatement: "the writer", rank: 1, createdAt: "x", frequency: { kind: "daily" } } });
    const user = userEvent.setup();
    render(<HabitList habits={[]} pausedHabits={[]} today="2026-10-07" />);
    await user.click(screen.getByRole("button", { name: "+ Add an identity habit" }));
    await user.type(screen.getByPlaceholderText(/Identity statement/), "the writer");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(createMock).toHaveBeenCalledWith("the writer", { kind: "daily" });
    expect(screen.queryByTestId("habit-cadence")).not.toBeInTheDocument();
  });

  it("changing 'how often' on a row saves it, updates the row, and shows an invalid choice as unsavable", async () => {
    setFrequencyMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<HabitList habits={[habit("h1", "A reader")]} pausedHabits={[]} today="2026-10-07" />);
    await user.click(screen.getByRole("button", { name: "Change how often" }));
    const editor = screen.getByTestId("habit-frequency-editor");
    expect(within(editor).getByRole("button", { name: "Save" })).toBeDisabled(); // unchanged
    await user.click(within(editor).getByRole("radio", { name: "Per month" }));
    const count = within(editor).getByRole("spinbutton", { name: "Times per month" });
    await user.clear(count);
    await user.type(count, "40");
    expect(within(editor).getByRole("button", { name: "Save" })).toBeDisabled(); // over the cap
    await user.clear(count);
    await user.type(count, "4");
    await user.click(within(editor).getByRole("button", { name: "Save" }));
    expect(setFrequencyMock).toHaveBeenCalledWith("h1", { kind: "per_month", count: 4 });
    expect(await screen.findByTestId("habit-cadence")).toHaveTextContent("4× a month");
    expect(screen.queryByTestId("habit-frequency-editor")).not.toBeInTheDocument();
  });

  it("a server refusal leaves the old cadence in place and shows the message", async () => {
    setFrequencyMock.mockResolvedValue({ error: "No identity habit found with id \"h1\"." });
    const user = userEvent.setup();
    render(<HabitList habits={[habit("h1", "A reader")]} pausedHabits={[]} today="2026-10-07" />);
    await user.click(screen.getByRole("button", { name: "Change how often" }));
    await user.click(screen.getByRole("radio", { name: "Per week" }));
    await user.click(within(screen.getByTestId("habit-frequency-editor")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/No identity habit found/)).toBeInTheDocument();
    expect(screen.queryByTestId("habit-cadence")).not.toBeInTheDocument();
  });
});
