import { render, screen, fireEvent } from "@testing-library/react";
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
      {
        id: "a",
        dayOfWeek: 1,
        title: "CS-3341-HON",
        startMinutes: 8 * 60 + 30,
        durationMinutes: 75,
        colorVar: "--series-school",
        kind: "class",
      },
    ];
    render(<WeekHourGrid items={items} />);
    expect(screen.getByTestId("week-hour-grid-item-a")).toBeInTheDocument();
    expect(screen.getByTestId("week-hour-grid-track-1")).toContainElement(screen.getByTestId("week-hour-grid-item-a"));
    expect(screen.getByTestId("week-hour-grid-track-2").textContent).not.toContain("CS-3341-HON");
  });

  it("highlights today's column when todayDayOfWeek is provided", () => {
    render(<WeekHourGrid items={[]} todayDayOfWeek={3} />);
    expect(screen.getByTestId("week-hour-grid-track-3").className).toContain("accent-info");
    expect(screen.getByTestId("week-hour-grid-track-2").className).not.toContain("accent-info");
  });

  it("renders two overlapping same-day items as distinct blocks (side-by-side)", () => {
    const items: CalendarItem[] = [
      { id: "a", dayOfWeek: 2, title: "Class A", startMinutes: 10 * 60, durationMinutes: 60, colorVar: "--series-school", kind: "class" },
      { id: "b", dayOfWeek: 2, title: "Class B", startMinutes: 10 * 60 + 15, durationMinutes: 60, colorVar: "--series-school", kind: "class" },
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

  it("falls back to a sane default axis (not a NaN/zero-span one) when there is nothing to size against", () => {
    // computeAxis([]) — no items to derive a range from — must return the
    // module's default 5am-11pm window, not a degenerate zero-span one. A
    // reachable state (a break week, or a brand-new account) that would
    // otherwise divide-by-zero every block's position% into NaN.
    render(<WeekHourGrid items={[]} />);
    const dayLabel = screen.getByTestId("week-hour-grid-day-label-1");
    expect(dayLabel.textContent).toBe("Mon");
    const track = screen.getByTestId("week-hour-grid-track-1");
    expect(track.style.height).not.toBe("0px");
    expect(track.style.height).not.toContain("NaN");
  });

  it("drops the label on a block too short to hold it legibly, without dropping the block itself", () => {
    const items: CalendarItem[] = [
      { id: "a", dayOfWeek: 4, title: "Due: Lab report", startMinutes: 9 * 60, durationMinutes: 15, colorVar: "--series-school", kind: "task" },
    ];
    render(<WeekHourGrid items={items} />);
    const block = screen.getByTestId("week-hour-grid-item-a");
    expect(block).toBeInTheDocument();
    expect(block.textContent).toBe("");
  });

  it("opens a detail popover with title, time range, location, and instructor on click", () => {
    const items: CalendarItem[] = [
      {
        id: "a",
        dayOfWeek: 1,
        title: "PHYS-2326-002",
        startMinutes: 9 * 60,
        durationMinutes: 75,
        colorVar: "--series-school",
        kind: "class",
        detail: { timeRange: "9:00 AM–10:15 AM", location: "SCI 204", instructor: "Dr. Alam", domainLabel: "School" },
      },
    ];
    render(<WeekHourGrid items={items} />);
    fireEvent.click(screen.getByTestId("week-hour-grid-item-a"));
    expect(screen.getByText("9:00 AM–10:15 AM")).toBeInTheDocument();
    expect(screen.getByText("SCI 204")).toBeInTheDocument();
    expect(screen.getByText("Dr. Alam")).toBeInTheDocument();
    expect(screen.getByText("School")).toBeInTheDocument();
  });

  it("does not make a detail-less block interactive with a popover", () => {
    const items: CalendarItem[] = [
      { id: "a", dayOfWeek: 1, title: "No detail", startMinutes: 9 * 60, durationMinutes: 60, colorVar: "--series-school", kind: "class" },
    ];
    render(<WeekHourGrid items={items} />);
    fireEvent.click(screen.getByTestId("week-hour-grid-item-a"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
