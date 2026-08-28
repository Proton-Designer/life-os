import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkScheduleWeek, todayScheduleLabel, type WorkScheduleEvent } from "../work-schedule-week";

const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

function event(overrides: Partial<WorkScheduleEvent> = {}): WorkScheduleEvent {
  return {
    id: "e1",
    isRecurring: true,
    dayOfWeek: 1,
    eventDate: null,
    eventTime: "10:30",
    endTime: "17:30",
    cancelledDates: [],
    overrides: [],
    ...overrides,
  };
}

describe("WorkScheduleWeek", () => {
  it("shows the actual start-end time, not the literal word 'Work'", () => {
    render(<WorkScheduleWeek events={[event()]} weekDates={WEEK_DATES} todayStr="2026-08-24" />);
    expect(screen.getByText("10:30 AM–5:30 PM")).toBeInTheDocument();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
  });

  it("highlights today's column, matching School's ClassScheduleWeek treatment", () => {
    render(<WorkScheduleWeek events={[]} weekDates={WEEK_DATES} todayStr="2026-08-26" />);
    // Wed = weekDates[3] = 2026-08-26
    expect(screen.getByTestId("work-schedule-day-3").className).toContain("border-accent-info/50");
    expect(screen.getByTestId("work-schedule-day-1").className).not.toContain("border-accent-info/50");
  });

  it("shows a cancelled occurrence struck through and labeled, not absent", () => {
    render(
      <WorkScheduleWeek
        events={[event({ dayOfWeek: 1, cancelledDates: ["2026-08-24"] })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("10:30 AM–5:30 PM")).not.toBeInTheDocument();
  });

  it("shows an active override's time marked '(this week)', distinguishable from the permanent schedule", () => {
    render(
      <WorkScheduleWeek
        events={[event({ dayOfWeek: 1, overrides: [{ date: "2026-08-24", eventTime: "12:00", endTime: "15:00" }] })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    expect(screen.getByText("12:00 PM–3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("(this week)")).toBeInTheDocument();
    expect(screen.queryByText("10:30 AM–5:30 PM")).not.toBeInTheDocument();
  });

  it("shows an empty dash for a day with no shift", () => {
    render(<WorkScheduleWeek events={[]} weekDates={WEEK_DATES} todayStr="2026-08-24" />);
    expect(screen.getByTestId("work-schedule-day-0")).toHaveTextContent("—");
  });

  it("places a one-off (non-recurring) shift on its own exact date", () => {
    render(
      <WorkScheduleWeek
        events={[event({ isRecurring: false, dayOfWeek: null, eventDate: "2026-08-23", eventTime: "09:00", endTime: "12:00" })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    expect(screen.getByTestId("work-schedule-day-0")).toHaveTextContent("9:00 AM–12:00 PM");
  });

  it("renders a compact strip with the same day resolution, one shrink-0 chip per day", () => {
    render(
      <WorkScheduleWeek events={[event()]} weekDates={WEEK_DATES} todayStr="2026-08-24" compact />
    );
    expect(screen.getByTestId("work-schedule-week-compact")).toBeInTheDocument();
    expect(screen.getByTestId("work-schedule-day-1")).toHaveTextContent("10:30 AM–5:30 PM");
  });
});

describe("todayScheduleLabel", () => {
  it("shows today's resolved shift time", () => {
    expect(todayScheduleLabel([event({ dayOfWeek: 1 })], WEEK_DATES, "2026-08-24")).toBe("10:30 AM–5:30 PM");
  });

  it("shows a clear no-shift message when nothing is scheduled today", () => {
    expect(todayScheduleLabel([], WEEK_DATES, "2026-08-24")).toBe("No shift today");
  });

  it("treats a cancelled occurrence as no shift, not as the underlying time", () => {
    expect(
      todayScheduleLabel([event({ dayOfWeek: 1, cancelledDates: ["2026-08-24"] })], WEEK_DATES, "2026-08-24")
    ).toBe("No shift today");
  });

  it("joins multiple shifts on the same day", () => {
    const shifts = [
      event({ id: "a", dayOfWeek: 1, eventTime: "09:00", endTime: "12:00" }),
      event({ id: "b", dayOfWeek: 1, eventTime: "13:00", endTime: "17:00" }),
    ];
    expect(todayScheduleLabel(shifts, WEEK_DATES, "2026-08-24")).toBe("9:00 AM–12:00 PM, 1:00 PM–5:00 PM");
  });
});
