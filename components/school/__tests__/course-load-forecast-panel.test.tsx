import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourseLoadForecastPanel } from "../course-load-forecast-panel";
import type { CourseLoadForecast } from "@/lib/school/course-load-forecast";

const TODAY = "2026-09-15";

function forecast(weeks: CourseLoadForecast["weeks"], hasAnyUpcomingWork = weeks.some((w) => w.itemCount > 0)): CourseLoadForecast {
  return { weeks, hasAnyUpcomingWork };
}

function week(overrides: Partial<CourseLoadForecast["weeks"][number]> = {}): CourseLoadForecast["weeks"][number] {
  return { weekStart: "2026-09-20", items: [], itemCount: 0, heavyItemCount: 0, totalWeightPct: null, overflow: false, ...overrides };
}

describe("CourseLoadForecastPanel (Phase 2 #P2-10)", () => {
  it("shows an honest empty-state message when there's no upcoming work -- never a fabricated grid", () => {
    render(<CourseLoadForecastPanel forecast={forecast([week()], false)} todayStr={TODAY} />);
    expect(screen.getByText(/Not enough upcoming, ungraded assessments/)).toBeInTheDocument();
    expect(screen.queryByTestId(/course-load-week-/)).not.toBeInTheDocument();
  });

  it("renders one row per week, including light weeks with 'Nothing due.'", () => {
    render(
      <CourseLoadForecastPanel
        forecast={forecast([
          week({ weekStart: "2026-09-13" }),
          week({
            weekStart: "2026-09-20",
            itemCount: 1,
            items: [{ id: "a1", name: "Midterm", className: "CS 101", date: "2026-09-22", weightPct: 30, heavy: true }],
          }),
        ])}
        todayStr={TODAY}
      />,
    );
    expect(screen.getByTestId("course-load-week-2026-09-13")).toHaveTextContent("Nothing due.");
    expect(screen.getByTestId("course-load-week-2026-09-20")).toHaveTextContent("Midterm");
  });

  it("shows an Overflow badge only on weeks flagged overflow", () => {
    render(
      <CourseLoadForecastPanel
        forecast={forecast([
          week({ weekStart: "2026-09-13", overflow: false }),
          week({ weekStart: "2026-09-20", itemCount: 3, overflow: true }),
        ])}
        todayStr={TODAY}
      />,
    );
    expect(screen.getByTestId("course-load-week-2026-09-13")).not.toHaveTextContent("Overflow");
    expect(screen.getByTestId("course-load-week-2026-09-20")).toHaveTextContent("Overflow");
  });

  it("shows a heavy item's weight percentage styled distinctly from a light item's", () => {
    render(
      <CourseLoadForecastPanel
        forecast={forecast([
          week({
            weekStart: "2026-09-20",
            itemCount: 2,
            items: [
              { id: "heavy", name: "Final Exam", className: "CS 101", date: "2026-09-22", weightPct: 30, heavy: true },
              { id: "light", name: "Quiz 3", className: "CS 101", date: "2026-09-23", weightPct: 5, heavy: false },
            ],
          }),
        ])}
        todayStr={TODAY}
      />,
    );
    const row = screen.getByTestId("course-load-week-2026-09-20");
    expect(row).toHaveTextContent("30%");
    expect(row).toHaveTextContent("5%");
  });

  it("an item with no weight shows no percentage at all -- never a fabricated 0%", () => {
    render(
      <CourseLoadForecastPanel
        forecast={forecast([
          week({
            weekStart: "2026-09-20",
            itemCount: 1,
            items: [{ id: "a1", name: "Reading response", className: "ENGL 101", date: "2026-09-22", weightPct: null, heavy: false }],
          }),
        ])}
        todayStr={TODAY}
      />,
    );
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});
