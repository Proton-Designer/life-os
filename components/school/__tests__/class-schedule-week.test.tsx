import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassScheduleWeek, type ClassScheduleEvent } from "../class-schedule-week";

const WEEK_DATES = ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];

function event(overrides: Partial<ClassScheduleEvent> = {}): ClassScheduleEvent {
  return {
    id: "e1",
    title: "CS-3341-HON",
    dayOfWeek: 1,
    eventTime: "08:30",
    endTime: "09:45",
    location: "ECSN 2.120",
    instructor: "Nicholas Robert Ruozzi",
    cancelledDates: [],
    ...overrides,
  };
}

describe("ClassScheduleWeek", () => {
  it("shows time range, room, and instructor for a class", () => {
    render(<ClassScheduleWeek events={[event()]} weekDates={WEEK_DATES} todayStr="2026-08-24" />);
    expect(screen.getByText("CS-3341-HON")).toBeInTheDocument();
    expect(screen.getByText("8:30 AM–9:45 AM")).toBeInTheDocument();
    expect(screen.getByText("ECSN 2.120")).toBeInTheDocument();
    expect(screen.getByText("Nicholas Robert Ruozzi")).toBeInTheDocument();
  });

  it("groups classes onto their day-of-week column, not a flat list", () => {
    render(
      <ClassScheduleWeek
        events={[event({ id: "mon", dayOfWeek: 1, title: "Mon class" }), event({ id: "wed", dayOfWeek: 3, title: "Wed class" })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    const mon = screen.getByTestId("class-schedule-day-1");
    const wed = screen.getByTestId("class-schedule-day-3");
    expect(mon).toHaveTextContent("Mon class");
    expect(mon).not.toHaveTextContent("Wed class");
    expect(wed).toHaveTextContent("Wed class");
  });

  it("still shows a class cancelled for that specific date, struck through and marked Cancelled — not absent", () => {
    render(
      <ClassScheduleWeek
        events={[event({ dayOfWeek: 1, cancelledDates: ["2026-08-24"] })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    expect(screen.getByText("CS-3341-HON")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    // Cancelled means "don't attend," not "no detail" — but time/room/instructor
    // give way to the cancellation notice rather than both showing at once.
    expect(screen.queryByText("8:30 AM–9:45 AM")).not.toBeInTheDocument();
  });

  it("renders a recurring class normally on a different week where it wasn't cancelled", () => {
    render(
      <ClassScheduleWeek
        events={[event({ dayOfWeek: 1, cancelledDates: ["2026-08-17"] })]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    expect(screen.getByText("CS-3341-HON")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("distinguishes today's column from the rest via todayStr, not the server's own clock", () => {
    render(<ClassScheduleWeek events={[]} weekDates={WEEK_DATES} todayStr="2026-08-26" />);
    // Wed = weekDates[3] = 2026-08-26
    expect(screen.getByTestId("class-schedule-day-3").className).toContain("border-accent-info/50");
    expect(screen.getByTestId("class-schedule-day-1").className).not.toContain("border-accent-info/50");
  });

  it("sorts multiple classes on the same day by start time", () => {
    render(
      <ClassScheduleWeek
        events={[
          event({ id: "late", dayOfWeek: 2, eventTime: "16:00", title: "Late class" }),
          event({ id: "early", dayOfWeek: 2, eventTime: "10:00", title: "Early class" }),
        ]}
        weekDates={WEEK_DATES}
        todayStr="2026-08-24"
      />
    );
    const items = screen.getByTestId("class-schedule-day-2").querySelectorAll("li");
    expect(items[0]).toHaveTextContent("Early class");
    expect(items[1]).toHaveTextContent("Late class");
  });

  it("shows an empty dash for a day with no classes", () => {
    render(<ClassScheduleWeek events={[]} weekDates={WEEK_DATES} todayStr="2026-08-24" />);
    expect(screen.getByTestId("class-schedule-day-0")).toHaveTextContent("—");
  });
});
