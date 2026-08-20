import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FitnessDayView } from "../fitness-day-view";

const DAYS = [1, 2, 3, 4, 5].map((d) => ({
  dayOfWeek: d,
  label: ["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1],
  workoutId: d === 1 ? "w1" : d === 2 ? "w2" : null,
  workoutName: d === 1 ? "Push A" : d === 2 ? "Pull A" : null,
}));

const DATES = { 1: "2026-08-17", 2: "2026-08-18", 3: "2026-08-19", 4: "2026-08-20", 5: "2026-08-21" };
const LABELS = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };

function exercise(id: string, name: string) {
  return {
    exerciseId: id,
    name,
    targetSets: 3,
    targetRepsLow: 8,
    targetRepsHigh: 10,
    targetLoad: null,
    lastTopSet: null,
  };
}

const WORKOUTS = {
  1: { id: "w1", name: "Push A", exercises: [exercise("e1", "Cable Press")] },
  2: { id: "w2", name: "Pull A", exercises: [exercise("e2", "Cable Row")] },
  3: null,
  4: null,
  5: null,
};

describe("FitnessDayView", () => {
  it("defaults the selected day to today", () => {
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={2}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/Pull A — Today/)).toBeInTheDocument();
  });

  it("falls back to Monday when today is a weekend (no cell to default to)", () => {
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={0}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText(/Push A — Mon/)).toBeInTheDocument();
  });

  it("switching days updates the detail panel to that day's workout", async () => {
    const user = userEvent.setup();
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={1}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    await user.click(screen.getByText("Tue"));
    expect(screen.getByText(/Pull A — Tue/)).toBeInTheDocument();
  });

  it("regression: switching days shows the NEW day's exercise rows, not stale rows from the previously-viewed day", async () => {
    const user = userEvent.setup();
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={1}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByTestId("session-row-e1")).toBeInTheDocument();
    await user.click(screen.getByText("Tue"));
    expect(screen.queryByTestId("session-row-e1")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-row-e2")).toBeInTheDocument();
  });

  it("regression: assigning a workout to an empty day (a prop update on an already-mounted instance) shows its exercises, not an empty list", () => {
    const withoutWorkout = { ...WORKOUTS, 3: null };
    const { rerender } = render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={3}
        workoutsByDay={withoutWorkout}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByTestId("session-detail-empty")).toBeInTheDocument();

    const withWorkout = { ...WORKOUTS, 3: { id: "w9", name: "Delts Day", exercises: [exercise("e9", "Lateral Raise")] } };
    rerender(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={3}
        workoutsByDay={withWorkout}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByTestId("session-detail-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-row-e9")).toBeInTheDocument();
  });

  it("a day with no assigned workout shows the empty message, not a crash", async () => {
    const user = userEvent.setup();
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={1}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    await user.click(screen.getByText("Wed"));
    expect(screen.getByTestId("session-detail-empty")).toHaveTextContent("Nothing planned for Wed.");
  });

  it("offers to assign a workout on an unassigned day and binds it to that day's number", async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn().mockResolvedValue(undefined);
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={1}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[{ id: "w9", name: "Delts Day" }]}
        onAssign={onAssign}
        onConfirm={vi.fn()}
      />
    );
    await user.click(screen.getByText("Wed"));
    await user.click(screen.getByText("Assign a workout"));
    await user.click(screen.getByText("Delts Day"));
    expect(onAssign).toHaveBeenCalledWith(3, "w9");
  });

  it("does not offer to assign a workout on a day that already has one", () => {
    render(
      <FitnessDayView
        days={DAYS}
        dates={DATES}
        dayLabels={LABELS}
        todayDayOfWeek={1}
        workoutsByDay={WORKOUTS}
        confirmedByDay={{}}
        savedWorkouts={[{ id: "w9", name: "Delts Day" }]}
        onAssign={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByText("Assign a workout")).not.toBeInTheDocument();
  });
});
