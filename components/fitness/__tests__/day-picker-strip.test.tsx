import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DayPickerStrip, type DayCell } from "../day-picker-strip";

const DAYS: DayCell[] = [
  { dayOfWeek: 1, label: "Mon", workoutId: "w1", workoutName: "Push A" },
  { dayOfWeek: 2, label: "Tue", workoutId: "w2", workoutName: "Pull A" },
  { dayOfWeek: 3, label: "Wed", workoutId: null, workoutName: null },
  { dayOfWeek: 4, label: "Thu", workoutId: "w1", workoutName: "Push A" },
  { dayOfWeek: 5, label: "Fri", workoutId: "w2", workoutName: "Pull A" },
];

const EMPTY_DAYS: DayCell[] = [1, 2, 3, 4, 5].map((d) => ({
  dayOfWeek: d,
  label: ["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1],
  workoutId: null,
  workoutName: null,
}));

describe("DayPickerStrip", () => {
  it("renders exactly five cells, Mon through Fri", () => {
    render(<DayPickerStrip days={DAYS} selectedDayOfWeek={1} todayDayOfWeek={1} onSelectDay={vi.fn()} />);
    expect(screen.getByTestId("day-picker-strip").children).toHaveLength(5);
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
  });

  it("tapping a cell calls onSelectDay with that day", async () => {
    const user = userEvent.setup();
    const onSelectDay = vi.fn();
    render(<DayPickerStrip days={DAYS} selectedDayOfWeek={1} todayDayOfWeek={1} onSelectDay={onSelectDay} />);
    await user.click(screen.getByText("Tue"));
    expect(onSelectDay).toHaveBeenCalledWith(2);
  });

  it("marks the selected day with aria-current", () => {
    render(<DayPickerStrip days={DAYS} selectedDayOfWeek={2} todayDayOfWeek={1} onSelectDay={vi.fn()} />);
    expect(screen.getByText("Tue").closest("button")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Mon").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("shows the week-one empty-state note when nothing is scheduled at all", () => {
    render(<DayPickerStrip days={EMPTY_DAYS} selectedDayOfWeek={1} todayDayOfWeek={1} onSelectDay={vi.fn()} />);
    expect(screen.getByTestId("day-picker-empty-note")).toHaveTextContent(
      "No sessions planned — you're on the daily rep targets"
    );
  });

  it("does not show the empty-state note once at least one day has a workout", () => {
    render(<DayPickerStrip days={DAYS} selectedDayOfWeek={1} todayDayOfWeek={1} onSelectDay={vi.fn()} />);
    expect(screen.queryByTestId("day-picker-empty-note")).not.toBeInTheDocument();
  });
});
