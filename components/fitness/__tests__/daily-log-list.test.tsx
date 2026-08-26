import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyLogList } from "../daily-log-list";
import type { DailyLogItem } from "@/lib/fitness/daily-log";

function noopHandlers() {
  return {
    onLogReps: vi.fn().mockResolvedValue(undefined),
    onConfirmSession: vi.fn().mockResolvedValue(undefined),
    onLogBenchmark: vi.fn().mockResolvedValue(undefined),
  };
}

// 2026-08-25 redesign: "when you press on an exercise it opens up a small
// input box below it ... change it so that it opens a popup right away"
// (Ayman) — every archetype except "session" opens a Dialog on tap instead
// of expanding inline.
//
// daily_check (protein/steps) and body_metric (weight/waist) are gone
// entirely as of 2026-08-25/26 batch 2, item 3 — see lib/fitness/daily-log.ts's
// own file comment. Their former coverage here was removed along with them;
// weight/waist logging is now covered in body-module.test.tsx instead.
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
