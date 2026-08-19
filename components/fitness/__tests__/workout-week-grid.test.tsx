import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const setWorkoutScheduleMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/app/(app)/fitness/actions", () => ({
  setWorkoutSchedule: (...args: unknown[]) => setWorkoutScheduleMock(...args),
}));

import { WorkoutWeekGrid, type ScheduledWorkout } from "../workout-week-grid";

function schedule(overrides: Partial<Record<number, ScheduledWorkout>> = {}): (ScheduledWorkout | null)[] {
  return Array.from({ length: 7 }, (_, i) => overrides[i] ?? null);
}

describe("WorkoutWeekGrid", () => {
  beforeEach(() => {
    setWorkoutScheduleMock.mockClear();
  });

  it("renders all 7 days with an em-dash for unscheduled ones", () => {
    render(<WorkoutWeekGrid schedule={schedule()} />);
    for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("—").length).toBe(7);
  });

  it("shows the scheduled workout name for a day that has one", () => {
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    expect(screen.getByText("Push")).toBeInTheDocument();
  });

  it("opens the editor with the duration field blank when no duration is set — blank must read as optional, not zero", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    const duration = screen.getByLabelText(/duration/i);
    expect(duration).toHaveValue(null);
    expect(duration).toHaveAttribute("placeholder");
    expect(duration.getAttribute("placeholder")).toMatch(/optional|default/i);
  });

  it("opens the editor pre-filled with the real duration when one is stored", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: 75, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/duration/i)).toHaveValue(75);
  });

  it("the duration input never pre-fills a value on its own — it starts blank for a day with no stored duration even if a name exists", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 2: { workoutName: "Legs", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /tue/i }));
    expect(screen.getByLabelText(/duration/i)).toHaveValue(null);
  });

  it("saves null duration when the field is left blank", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, null);
  });

  it("saves the exact duration typed when it's already a valid 15-minute step", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.type(screen.getByLabelText(/duration/i), "75");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, 75);
  });

  it("snaps an off-step duration to the nearest 15 minutes before saving", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.type(screen.getByLabelText(/duration/i), "37");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, 30);
  });

  it("clamps a duration above 240 down to the max", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.type(screen.getByLabelText(/duration/i), "500");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, 240);
  });

  it("clamps a duration below 15 up to the min, distinct from leaving it blank", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.type(screen.getByLabelText(/duration/i), "5");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, 15);
  });

  it("clearing the workout name still deletes the day's schedule, ignoring whatever duration was typed", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: 60, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.clear(screen.getByDisplayValue("Push"));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, null, null, null);
  });

  it("the duration input is a real range with 15-minute steps for keyboard/spinner interaction", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    const duration = screen.getByLabelText(/duration/i);
    expect(duration).toHaveAttribute("step", "15");
    expect(duration).toHaveAttribute("min", "15");
    expect(duration).toHaveAttribute("max", "240");
  });

  it("reopening after a save reflects the newly-persisted value, not whatever was last typed — found live: reopening after save showed the stale unsnapped '37' instead of the saved 30", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByLabelText(/duration/i), "37");
    await user.click(screen.getByRole("button", { name: /save/i }));

    // Save closes the popover itself. Simulate the server round-trip
    // completing and the parent re-rendering with the real, now-snapped,
    // persisted value, then reopen.
    rerender(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: 30, time: null } })} />);

    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/duration/i)).toHaveValue(30);
  });

  it("meets the 44px minimum tap target on the duration field and Save", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/duration/i).className).toMatch(/min-h-11/);
    expect(screen.getByRole("button", { name: /save/i }).className).toMatch(/min-h-11/);
  });

  it("the planned-time field starts blank when no time is stored, even for a day with a name and duration", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: 45, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/planned time/i)).toHaveValue("");
  });

  it("pre-fills the planned-time field with the real stored time", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: "18:00" } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/planned time/i)).toHaveValue("18:00");
  });

  it("trims a stored time with seconds to HH:MM — found live: Postgres's `time` column round-trips as '18:00:00', which a native time input without a seconds step silently can't fully honor", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: "18:00:00" } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/planned time/i)).toHaveValue("18:00");
  });

  it("saves null time when the field is left blank", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", null, null);
  });

  it("saves the typed planned time", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule()} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.type(screen.getByPlaceholderText(/workout name/i), "Push");
    fireEvent.change(screen.getByLabelText(/planned time/i), { target: { value: "18:00" } });
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, "Push", "18:00", null);
  });

  it("clearing the workout name discards the typed time too, same as duration", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: "18:00" } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    await user.clear(screen.getByDisplayValue("Push"));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(setWorkoutScheduleMock).toHaveBeenCalledWith(1, null, null, null);
  });

  it("reopening after a save reflects the newly-persisted time too, not a stale one", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    fireEvent.change(screen.getByLabelText(/planned time/i), { target: { value: "07:30" } });
    await user.click(screen.getByRole("button", { name: /save/i }));

    // The real round-trip: Postgres's `time` column comes back with
    // seconds, not the bare "07:30" that was typed.
    rerender(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: "07:30:00" } })} />);

    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/planned time/i)).toHaveValue("07:30");
  });

  it("meets the 44px minimum tap target on the planned-time field", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByLabelText(/planned time/i).className).toMatch(/min-h-11/);
  });

  it("the planned-time label frames it as a plan, not a record of what happened", async () => {
    const user = userEvent.setup();
    render(<WorkoutWeekGrid schedule={schedule({ 1: { workoutName: "Push", durationMinutes: null, time: null } })} />);
    await user.click(screen.getByRole("button", { name: /mon/i }));
    expect(screen.getByText(/planned time/i)).toBeInTheDocument();
    expect(screen.queryByText(/^time$/i)).not.toBeInTheDocument();
  });
});
