import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeekHourGrid, type CalendarItem } from "../week-hour-grid";

describe("WeekHourGrid", () => {
  it("renders all seven day tracks", () => {
    render(<WeekHourGrid items={[]} />);
    for (let d = 0; d <= 6; d++) {
      expect(screen.getByTestId(`week-hour-grid-track-${d}`)).toBeInTheDocument();
    }
  });

  it("places an item on its own day's track", () => {
    const items: CalendarItem[] = [
      { id: "a", dayOfWeek: 1, title: "CS-3341-HON", startMinutes: 8 * 60 + 30, durationMinutes: 75, colorVar: "--series-school" },
    ];
    render(<WeekHourGrid items={items} />);
    expect(screen.getByTestId("week-hour-grid-item-a")).toBeInTheDocument();
    expect(screen.getByTestId("week-hour-grid-track-1")).toContainElement(screen.getByTestId("week-hour-grid-item-a"));
    expect(screen.getByTestId("week-hour-grid-track-2").textContent).not.toContain("CS-3341-HON");
  });

  it("highlights today's column when todayDayOfWeek is provided", () => {
    render(<WeekHourGrid items={[]} todayDayOfWeek={3} />);
    expect(screen.getByTestId("week-hour-grid-track-3").className).toContain("border-accent-info");
    expect(screen.getByTestId("week-hour-grid-track-2").className).not.toContain("border-accent-info");
  });

  it("renders two overlapping same-day items as distinct blocks (side-by-side)", () => {
    const items: CalendarItem[] = [
      { id: "a", dayOfWeek: 2, title: "Class A", startMinutes: 10 * 60, durationMinutes: 60, colorVar: "--series-school" },
      { id: "b", dayOfWeek: 2, title: "Class B", startMinutes: 10 * 60 + 15, durationMinutes: 60, colorVar: "--series-school" },
    ];
    render(<WeekHourGrid items={items} />);
    const a = screen.getByTestId("week-hour-grid-item-a");
    const b = screen.getByTestId("week-hour-grid-item-b");
    expect(a.style.left).not.toBe(b.style.left);
  });

  it("handles an entirely empty week without throwing", () => {
    render(<WeekHourGrid items={[]} />);
    expect(screen.getByTestId("week-hour-grid")).toBeInTheDocument();
  });
});
