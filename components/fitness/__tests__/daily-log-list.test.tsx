import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyLogList } from "../daily-log-list";
import type { DailyLogItem } from "@/lib/fitness/daily-log";

function noopHandlers() {
  return {
    onLogReps: vi.fn().mockResolvedValue(undefined),
    onConfirmSession: vi.fn().mockResolvedValue(undefined),
    onToggleDailyCheck: vi.fn().mockResolvedValue(undefined),
    onLogWeight: vi.fn().mockResolvedValue(undefined),
    onLogWaist: vi.fn().mockResolvedValue(undefined),
    onLogBenchmark: vi.fn().mockResolvedValue(undefined),
  };
}

// 2026-08-25 redesign: "when you press on an exercise it opens up a small
// input box below it ... change it so that it opens a popup right away"
// (Ayman) — every archetype except "session" now opens a Dialog on tap
// instead of expanding inline.
describe("DailyLogList — popup logging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tapping a micro_total row opens a dialog immediately, not an inline box", async () => {
    const item: DailyLogItem = { kind: "micro_total", exerciseId: "e1", name: "Push-ups", logged: 10, target: 30, notes: null };
    const handlers = noopHandlers();
    const user = userEvent.setup();
    render(
      <DailyLogList
        date="2026-08-25"
        items={[item]}
        sessionDetailsBySessionId={{}}
        benchmarkExercises={[]}
        {...handlers}
      />
    );

    expect(screen.queryByLabelText("Push-ups reps this bout")).not.toBeInTheDocument();
    await user.click(screen.getByText("Push-ups"));

    const input = screen.getByLabelText("Push-ups reps this bout");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(screen.getByText("10/30 so far")).toBeInTheDocument();
  });

  it("Enter in the count input submits the log, same as pressing Log", async () => {
    const item: DailyLogItem = { kind: "micro_total", exerciseId: "e1", name: "Push-ups", logged: 10, target: 30, notes: null };
    const handlers = noopHandlers();
    const user = userEvent.setup();
    render(
      <DailyLogList date="2026-08-25" items={[item]} sessionDetailsBySessionId={{}} benchmarkExercises={[]} {...handlers} />
    );

    await user.click(screen.getByText("Push-ups"));
    const input = screen.getByLabelText("Push-ups reps this bout");
    await user.clear(input);
    await user.type(input, "5{Enter}");

    expect(handlers.onLogReps).toHaveBeenCalledWith("e1", "Push-ups", 5);
  });

  it("tapping a body_metric row opens a dialog with a Save button, focused input", async () => {
    const item: DailyLogItem = { kind: "body_metric", metric: "weight", lastValue: 180, lastDate: "2026-08-24" };
    const handlers = noopHandlers();
    const user = userEvent.setup();
    render(
      <DailyLogList date="2026-08-25" items={[item]} sessionDetailsBySessionId={{}} benchmarkExercises={[]} {...handlers} />
    );

    await user.click(screen.getByText("Log today's weight"));
    const input = screen.getByLabelText("Weight (lb)");
    expect(input).toHaveFocus();
    await user.type(input, "182");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(handlers.onLogWeight).toHaveBeenCalledWith(182);
  });

  it("tapping the benchmark row opens BenchmarkForm inside a dialog", async () => {
    const item: DailyLogItem = { kind: "benchmark", cycleNumber: 2, dueBy: "2026-08-27" };
    const handlers = noopHandlers();
    const user = userEvent.setup();
    render(
      <DailyLogList
        date="2026-08-25"
        items={[item]}
        sessionDetailsBySessionId={{}}
        benchmarkExercises={[{ exerciseId: "e1", name: "Pull-ups" }]}
        {...handlers}
      />
    );

    expect(screen.queryByTestId("benchmark-form")).not.toBeInTheDocument();
    await user.click(screen.getByText(/Cycle 2 benchmark due/));
    expect(screen.getByTestId("benchmark-form")).toBeInTheDocument();
  });

  it("a session row still expands INLINE, not into a dialog — the deliberate exception", async () => {
    const item: DailyLogItem = {
      kind: "session",
      sessionId: "s1",
      name: "Push Day",
      durationMinutes: 45,
      startTime: "18:00",
      confirmed: false,
    };
    const handlers = noopHandlers();
    const user = userEvent.setup();
    render(
      <DailyLogList
        date="2026-08-25"
        items={[item]}
        sessionDetailsBySessionId={{ s1: { exercises: [] } }}
        benchmarkExercises={[]}
        {...handlers}
      />
    );

    await user.click(screen.getByText("Push Day"));
    // No dialog role should appear — SessionDetailPanel renders inline in the flow.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// A2: the zero-feedback bug — a daily_check tap used to change nothing on
// screen until the server round-tripped, 1-3s later, which read as a
// missed tap ("you have to tap it multiple times").
describe("DailyLogList — daily_check one-tap feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an instant checkmark and strikethrough on the very click, before the action resolves", async () => {
    let resolveToggle!: () => void;
    const handlers = noopHandlers();
    handlers.onToggleDailyCheck.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve;
        })
    );
    const item: DailyLogItem = { kind: "daily_check", checkKind: "protein", done: false };
    const user = userEvent.setup();
    render(
      <DailyLogList date="2026-08-25" items={[item]} sessionDetailsBySessionId={{}} benchmarkExercises={[]} {...handlers} />
    );

    const row = screen.getByTestId("daily-log-check-protein");
    expect(screen.getByText("Hit protein target")).not.toHaveClass("line-through");

    await user.click(row);

    expect(screen.getByText("Hit protein target")).toHaveClass("line-through");
    expect(handlers.onToggleDailyCheck).toHaveBeenCalledWith("protein");
    resolveToggle();
  });

  it("ignores a second tap while the first toggle is still in flight (no double-fire)", async () => {
    const handlers = noopHandlers();
    handlers.onToggleDailyCheck.mockImplementation(() => new Promise<void>(() => {}));
    const item: DailyLogItem = { kind: "daily_check", checkKind: "steps", done: false };
    const user = userEvent.setup();
    render(
      <DailyLogList date="2026-08-25" items={[item]} sessionDetailsBySessionId={{}} benchmarkExercises={[]} {...handlers} />
    );

    const row = screen.getByTestId("daily-log-check-steps");
    await user.click(row);
    await user.click(row);
    await user.click(row);

    expect(handlers.onToggleDailyCheck).toHaveBeenCalledTimes(1);
  });
});
