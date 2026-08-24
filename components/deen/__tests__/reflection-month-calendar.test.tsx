import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReflectionMonthCalendar } from "../reflection-month-calendar";

function cellFor(date: string): HTMLElement {
  const cell = screen.getAllByTestId("reflection-month-cell").find((c) => c.dataset.date === date);
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}

describe("ReflectionMonthCalendar", () => {
  it("renders the month label and one cell per in-month day", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    const cells = screen.getAllByTestId("reflection-month-cell");
    expect(cells).toHaveLength(31);
  });

  it("shades a day by its weight and shows per-tier counts", () => {
    render(
      <ReflectionMonthCalendar
        entries={[
          { date: "2026-08-10", tier: 3 },
          { date: "2026-08-10", tier: 3 },
          { date: "2026-08-10", tier: 1 },
        ]}
        todayStr="2026-08-15"
      />
    );
    const cell = cellFor("2026-08-10");
    expect(cell.dataset.bucket).toBe("high");
    expect(cell).toHaveTextContent("L: 1");
    expect(cell).toHaveTextContent("M: 0");
    expect(cell).toHaveTextContent("H: 2");
  });

  it("marks today distinctly and, with no entries yet, as in_progress rather than clear", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    const today = cellFor("2026-08-15");
    expect(today.dataset.bucket).toBe("in_progress");
  });

  it("renders future days in the current month as empty, not clear", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    const future = cellFor("2026-08-20");
    expect(future.dataset.bucket).toBe("empty");
  });

  it("renders a past day with no entries as clear", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    const past = cellFor("2026-08-05");
    expect(past.dataset.bucket).toBe("clear");
  });

  it("flags an entirely empty month so it doesn't read as a wall of clean days", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    expect(screen.getByText("Nothing logged yet")).toBeInTheDocument();
  });

  it("hides the empty-month caption once at least one entry exists", () => {
    render(<ReflectionMonthCalendar entries={[{ date: "2026-08-10", tier: 1 }]} todayStr="2026-08-15" />);
    expect(screen.queryByText("Nothing logged yet")).not.toBeInTheDocument();
  });

  it("renders blank, non-interactive placeholders for the padding days outside the month", () => {
    render(<ReflectionMonthCalendar entries={[]} todayStr="2026-08-15" />);
    expect(screen.queryAllByTestId("reflection-month-cell").some((c) => c.dataset.date === "2026-07-31")).toBe(false);
  });
});
