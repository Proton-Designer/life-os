import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeadlineRiskPanel, type DeadlineRiskRow } from "../deadline-risk-panel";
import { weekDatesFrom, addDaysToDateString, getWeekStartDate } from "@/lib/date-utils";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";

const TODAY = "2026-09-15"; // a Tuesday
const WEEK_DATES = weekDatesFrom(getWeekStartDate(TODAY));
const NEXT_WEEK_DATES = weekDatesFrom(addDaysToDateString(WEEK_DATES[0]!, 7));
const HORIZON = addDaysToDateString(TODAY, 30);

function row(overrides: Partial<DeadlineRiskRow> & { id: string }): DeadlineRiskRow {
  return {
    name: "Assessment",
    className: "Class",
    dueDate: TODAY,
    risk: { score: 10, band: "low" },
    ...overrides,
  };
}

function renderPanel(rows: DeadlineRiskRow[]) {
  return render(
    <DeadlineRiskPanel rows={rows} todayStr={TODAY} weekDates={WEEK_DATES} nextWeekDates={NEXT_WEEK_DATES} horizonStr={HORIZON} />
  );
}

describe("DeadlineRiskPanel", () => {
  it("shows an honest empty state with zero rows", () => {
    renderPanel([]);
    expect(screen.getByText(/no upcoming assessments/i)).toBeInTheDocument();
  });

  it("excludes an overdue assessment from render, same as the Task list's own convention", () => {
    renderPanel([row({ id: "past", dueDate: "2026-09-01", risk: { score: 90, band: "critical" } })]);
    expect(screen.queryByText("Assessment")).not.toBeInTheDocument();
    expect(screen.getByText(/no upcoming assessments/i)).toBeInTheDocument();
  });

  it("ranks by risk score within a bucket, not by due date", () => {
    renderPanel([
      row({ id: "low-risk-sooner", name: "Low risk, due sooner", dueDate: TODAY, risk: { score: 10, band: "low" } }),
      row({ id: "high-risk-later", name: "High risk, due later", dueDate: WEEK_DATES[WEEK_DATES.length - 1], risk: { score: 90, band: "critical" } }),
    ]);
    const rows = screen.getAllByText(/risk, due/);
    expect(rows[0]).toHaveTextContent("High risk, due later");
    expect(rows[1]).toHaveTextContent("Low risk, due sooner");
  });

  it("groups under the shared TASK_GROUP_LABEL headers and shows class name + risk band", () => {
    renderPanel([row({ id: "a1", name: "Midterm", className: "Orgo II", dueDate: TODAY, risk: { score: 80, band: "critical" } })]);
    expect(screen.getByText("Due Soon")).toBeInTheDocument();
    expect(screen.getByTestId("deadline-risk-row-a1")).toHaveTextContent("Midterm");
    expect(screen.getByTestId("deadline-risk-row-a1")).toHaveTextContent("Orgo II");
    expect(screen.getByTestId("deadline-risk-row-a1")).toHaveTextContent("Critical");
  });

  it("renders a separate section per non-empty bucket, in TASK_GROUP_ORDER", () => {
    renderPanel([
      row({ id: "soon", dueDate: TODAY }),
      row({ id: "far", dueDate: addDaysToDateString(HORIZON, 10) }),
    ]);
    const headings = screen.getAllByText(/Due Soon|Upcoming|Future/);
    expect(headings.map((h) => h.textContent)).toEqual(["Due Soon", "Future"]);
  });

  const bands: RiskBand[] = ["low", "moderate", "high", "critical"];
  it.each(bands)("renders the %s band label on a row", (band) => {
    renderPanel([row({ id: "b1", risk: { score: 50, band } })]);
    expect(screen.getByTestId("deadline-risk-row-b1")).toHaveTextContent(band === "low" ? "Low" : band === "moderate" ? "Moderate" : band === "high" ? "High" : "Critical");
  });
});
