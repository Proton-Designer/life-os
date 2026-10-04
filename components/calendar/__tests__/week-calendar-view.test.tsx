import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeekCalendarView } from "../week-calendar-view";

const noop = async () => {};
const base = {
  items: [],
  undatedDeadlines: [],
  deen: { headline: "Finish Surah Kahf", milestones: [] },
  business: { headline: "Ship the landing page", milestones: [] },
};

describe("WeekCalendarView -- Deen Mode", () => {
  it("ON shows the Deen goal slot", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: true }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
  });

  it("OFF hides the Deen slot even if a deen goal is in the data, and keeps Business", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: false }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.queryByText("Deen")).not.toBeInTheDocument();
    expect(screen.queryByText("Finish Surah Kahf")).not.toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toBeInTheDocument();
  });
});
