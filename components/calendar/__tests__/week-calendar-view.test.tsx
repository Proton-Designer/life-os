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

describe("WeekCalendarView -- Personal goal", () => {
  it("shows the Personal goal slot with Faith Mode on", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: true }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
  });

  it("still shows it with Faith Mode off (it is a personal goal, not a Faith feature), alongside Business", () => {
    render(<WeekCalendarView data={{ ...base, deenMode: false }} onSaveDeen={noop} onSaveBusiness={noop} />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Finish Surah Kahf")).toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toBeInTheDocument();
  });
});
