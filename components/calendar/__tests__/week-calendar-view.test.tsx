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

describe("WeekCalendarView -- Faith Mode", () => {
  it("ON shows the Faith goal slot", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: true }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText("Faith")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
  });

  it("OFF hides the Faith slot even if a deen goal is in the data, and keeps Business", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: false }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.queryByText("Faith")).not.toBeInTheDocument();
    expect(screen.queryByText("Finish Surah Kahf")).not.toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toBeInTheDocument();
  });
});
