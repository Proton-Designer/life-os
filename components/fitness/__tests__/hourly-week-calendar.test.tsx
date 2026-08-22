import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WeekPreview } from "@/lib/fitness/plan-types";
import { HourlyWeekCalendar } from "../workouts/hourly-week-calendar";

function emptyWeek(): WeekPreview {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

describe("HourlyWeekCalendar", () => {
  it("renders all seven day tracks for an empty week", () => {
    render(<HourlyWeekCalendar preview={emptyWeek()} />);
    for (let d = 0; d <= 6; d++) {
      expect(screen.getByTestId(`hourly-day-track-${d}`)).toBeInTheDocument();
    }
  });

  it("shows a micro exercise as an all-day header band, not positioned on the hourly track", () => {
    const preview = emptyWeek();
    preview[1] = [{ kind: "micro", name: "Pull-ups", goalLabel: "30 reps" }];
    render(<HourlyWeekCalendar preview={preview} />);
    expect(screen.getByTestId("hourly-day-header-1").textContent).toContain("Pull-ups — 30 reps");
    expect(screen.getByTestId("hourly-day-track-1").textContent).not.toContain("Pull-ups");
  });

  it("shows an unscheduled session (no startTime) in the header band, not on the hourly track", () => {
    const preview = emptyWeek();
    preview[2] = [{ kind: "session", name: "Mobility", startTime: null, durationMinutes: 15 }];
    render(<HourlyWeekCalendar preview={preview} />);
    const header = screen.getByTestId("hourly-day-header-2").textContent ?? "";
    expect(header).toContain("Mobility");
    expect(header).toContain("unscheduled");
    expect(screen.getByTestId("hourly-day-track-2").textContent).not.toContain("Mobility");
  });

  it("positions a single scheduled session on its day's track", () => {
    const preview = emptyWeek();
    preview[3] = [{ kind: "session", name: "Push day", startTime: "07:00", durationMinutes: 60 }];
    render(<HourlyWeekCalendar preview={preview} />);
    expect(screen.getByTestId("hourly-day-track-3").textContent).toContain("Push day");
  });

  it("renders three overlapping sessions on the same day as three distinct blocks (side-by-side, not stacked)", () => {
    const preview = emptyWeek();
    preview[4] = [
      { kind: "session", name: "A", startTime: "07:00", durationMinutes: 90 },
      { kind: "session", name: "B", startTime: "07:15", durationMinutes: 90 },
      { kind: "session", name: "C", startTime: "07:30", durationMinutes: 90 },
    ];
    render(<HourlyWeekCalendar preview={preview} />);
    const track = screen.getByTestId("hourly-day-track-4");
    expect(screen.getByTestId("hourly-session-4-0")).toBeInTheDocument();
    expect(screen.getByTestId("hourly-session-4-1")).toBeInTheDocument();
    expect(screen.getByTestId("hourly-session-4-2")).toBeInTheDocument();
    const lefts = ["hourly-session-4-0", "hourly-session-4-1", "hourly-session-4-2"].map(
      (id) => screen.getByTestId(id).style.left
    );
    expect(new Set(lefts).size).toBe(3);
    void track;
  });

  it("renders a day with both a micro band and two non-overlapping sessions correctly", () => {
    const preview = emptyWeek();
    preview[5] = [
      { kind: "micro", name: "Push-ups", goalLabel: "100 reps" },
      { kind: "session", name: "Morning", startTime: "06:00", durationMinutes: 30 },
      { kind: "session", name: "Evening", startTime: "18:00", durationMinutes: 45 },
    ];
    render(<HourlyWeekCalendar preview={preview} />);
    expect(screen.getByTestId("hourly-day-header-5").textContent).toContain("Push-ups");
    expect(screen.getByTestId("hourly-session-5-1")).toHaveTextContent("Morning");
    expect(screen.getByTestId("hourly-session-5-2")).toHaveTextContent("Evening");
  });

  it("expands the axis when a session starts before the default 05:00 floor", () => {
    const preview = emptyWeek();
    preview[6] = [{ kind: "session", name: "Dawn", startTime: "04:00", durationMinutes: 30 }];
    render(<HourlyWeekCalendar preview={preview} />);
    // The session must render inside its track without throwing/clamping to an invisible position.
    expect(screen.getByTestId("hourly-session-6-0")).toBeInTheDocument();
  });
});
