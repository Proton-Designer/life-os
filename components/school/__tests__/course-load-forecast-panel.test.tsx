import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // UX-03: the parent app/(app)/school/page.tsx already wraps this in
  // <Panel title="Course load">, which renders the title unconditionally
  // (components/ui/panel.tsx) -- this component's own empty-state heading
  // printed it a second time, verbatim, directly underneath.
  it("does not print its own title in the empty state -- the parent Panel already shows it", () => {
    render(<CourseLoadForecastPanel forecast={forecast([week()], false)} todayStr={TODAY} />);
    expect(screen.queryByText("Course load")).not.toBeInTheDocument();
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

  // UX-06: DFT7 found a class with 40+ assessments dumping every item flat
  // in one week with no hierarchy.
  describe("heavy volume (UX-06)", () => {
    function lightItems(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `light-${i}`,
        name: `Light ${i}`,
        className: "CS 101",
        date: "2026-09-23",
        weightPct: 5,
        heavy: false,
      }));
    }

    it("shows every heavy item directly, with no cap", () => {
      const heavy = Array.from({ length: 8 }, (_, i) => ({
        id: `heavy-${i}`,
        name: `Heavy ${i}`,
        className: "CS 101",
        date: "2026-09-22",
        weightPct: 30,
        heavy: true,
      }));
      render(
        <CourseLoadForecastPanel
          forecast={forecast([week({ weekStart: "2026-09-20", itemCount: heavy.length, items: heavy })])}
          todayStr={TODAY}
        />,
      );
      const weekEl = screen.getByTestId("course-load-week-2026-09-20");
      for (const item of heavy) expect(weekEl).toHaveTextContent(item.name);
      expect(within(weekEl).queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
    });

    it("does not show a '+N more' control when light items are at or under the visible cap", () => {
      const items = lightItems(5);
      render(
        <CourseLoadForecastPanel
          forecast={forecast([week({ weekStart: "2026-09-20", itemCount: items.length, items })])}
          todayStr={TODAY}
        />,
      );
      const weekEl = screen.getByTestId("course-load-week-2026-09-20");
      for (const item of items) expect(weekEl).toHaveTextContent(item.name);
      expect(within(weekEl).queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
    });

    it("caps light items behind a '+N more' control once past the cap, never dropping them", async () => {
      const items = lightItems(9);
      render(
        <CourseLoadForecastPanel
          forecast={forecast([week({ weekStart: "2026-09-20", itemCount: items.length, items })])}
          todayStr={TODAY}
        />,
      );
      const weekEl = screen.getByTestId("course-load-week-2026-09-20");
      for (let i = 0; i < 5; i++) expect(weekEl).toHaveTextContent(`Light ${i}`);
      for (let i = 5; i < 9; i++) expect(within(weekEl).queryByText(`Light ${i}`)).not.toBeInTheDocument();
      const trigger = within(weekEl).getByRole("button", { name: "+4 more" });

      const user = userEvent.setup();
      await user.click(trigger);
      for (let i = 5; i < 9; i++) expect(weekEl).toHaveTextContent(`Light ${i}`);
    });

    it("keeps heavy items visible AND caps light items in the same week", () => {
      const items = [
        { id: "heavy-a", name: "Final Exam", className: "CS 101", date: "2026-09-22", weightPct: 30, heavy: true },
        ...lightItems(7),
      ];
      render(
        <CourseLoadForecastPanel
          forecast={forecast([week({ weekStart: "2026-09-20", itemCount: items.length, items })])}
          todayStr={TODAY}
        />,
      );
      const weekEl = screen.getByTestId("course-load-week-2026-09-20");
      expect(weekEl).toHaveTextContent("Final Exam");
      expect(within(weekEl).getByRole("button", { name: "+2 more" })).toBeInTheDocument();
    });
  });
});
