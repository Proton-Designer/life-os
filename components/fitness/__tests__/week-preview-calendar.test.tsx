import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WeekPreview } from "@/lib/fitness/plan-types";
import { WeekPreviewCalendar } from "../workouts/week-preview-calendar";

function emptyWeek(): WeekPreview {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

describe("WeekPreviewCalendar", () => {
  it("renders all seven days even when every day is empty", () => {
    render(<WeekPreviewCalendar preview={emptyWeek()} />);
    for (let d = 0; d <= 6; d++) {
      expect(screen.getByTestId(`week-preview-day-${d}`)).toBeInTheDocument();
    }
  });

  it("shows a micro exercise's goal label on its scheduled day", () => {
    const preview = emptyWeek();
    preview[1] = [{ kind: "micro", name: "Pull-ups", goalLabel: "30 reps" }];
    render(<WeekPreviewCalendar preview={preview} />);
    expect(screen.getByTestId("week-preview-day-1").textContent).toContain("Pull-ups — 30 reps");
  });

  it("shows a session's start time when scheduled, and 'unscheduled' when not", () => {
    const preview = emptyWeek();
    preview[2] = [
      { kind: "session", name: "Push day", startTime: "07:00", durationMinutes: 45 },
      { kind: "session", name: "Mobility", startTime: null, durationMinutes: 15 },
    ];
    render(<WeekPreviewCalendar preview={preview} />);
    const day = screen.getByTestId("week-preview-day-2").textContent ?? "";
    expect(day).toContain("Push day");
    expect(day).toContain("07:00");
    expect(day).toContain("Mobility");
    expect(day).toContain("unscheduled");
  });

  it("renders micro bands before session bands on a mixed day, regardless of input order", () => {
    const preview = emptyWeek();
    preview[3] = [
      { kind: "session", name: "Session Z", startTime: "18:00", durationMinutes: 30 },
      { kind: "micro", name: "Push-ups", goalLabel: "100 reps" },
    ];
    render(<WeekPreviewCalendar preview={preview} />);
    const day = screen.getByTestId("week-preview-day-3");
    const text = day.textContent ?? "";
    expect(text.indexOf("Push-ups")).toBeLessThan(text.indexOf("Session Z"));
  });

  it("shows an empty-day placeholder for a day with no items", () => {
    render(<WeekPreviewCalendar preview={emptyWeek()} />);
    expect(screen.getByTestId("week-preview-day-0").textContent).toContain("—");
  });
});
