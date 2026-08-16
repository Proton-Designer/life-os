import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";

const markPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
}));

import { DayRibbon } from "../day-ribbon";

const RANGE_START = new Date("2026-08-15T10:12:00Z");
const RANGE_END = new Date("2026-08-16T02:40:00Z");

const LAYOUT: DayRibbonLayout = {
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  now: new Date("2026-08-15T17:00:00Z"),
  nowPct: 40,
  nowPosition: "within",
  markers: [
    { name: "fajr", label: "Fajr", time: RANGE_START, pct: 0, state: "logged" },
    { name: "dhuhr", label: "Dhuhr", time: new Date("2026-08-15T17:56:00Z"), pct: 45, state: "upcoming" },
    { name: "asr", label: "Asr", time: new Date("2026-08-15T21:49:00Z"), pct: 70, state: "missed" },
  ],
  blocks: [{ label: "Deep work", colorVar: "--series-business", startPct: 10, endPct: 30 }],
};

describe("DayRibbon", () => {
  it("renders every prayer marker with its label and time", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByText("Dhuhr")).toBeInTheDocument();
    expect(screen.getByText("Asr")).toBeInTheDocument();
  });

  it("marks a prayer on-time when its marker is clicked", async () => {
    const user = userEvent.setup();
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    await user.click(screen.getByRole("button", { name: /Dhuhr/ }));
    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-15", "dhuhr", "on_time");
  });

  it("headlines the next upcoming prayer with a real time-until, always — not just when empty", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/Next: Dhuhr/)).toBeInTheDocument();
  });

  it("adds an invitation line when there are no activity blocks yet", () => {
    render(<DayRibbon layout={{ ...LAYOUT, blocks: [] }} todayStr="2026-08-15" timezone="UTC" />);
    expect(
      screen.getByText("Check-ins and Lock-In sessions will show up here as your day happens")
    ).toBeInTheDocument();
  });

  it("omits the invitation line once real activity exists", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(
      screen.queryByText("Check-ins and Lock-In sessions will show up here as your day happens")
    ).not.toBeInTheDocument();
  });

  it("renders a live on-track 'now' indicator when now falls within Fajr-Isha", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("shows an explicit 'until Fajr' headline before Fajr, not a silently-clamped indicator", () => {
    render(
      <DayRibbon
        layout={{ ...LAYOUT, now: new Date("2026-08-15T08:00:00Z"), nowPosition: "before", nowPct: 0 }}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    expect(screen.getByText(/until Fajr/)).toBeInTheDocument();
    // No on-track "now" line/label outside the range.
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  it("shows an explicit 'since Isha' headline after Isha, not a silently-clamped indicator", () => {
    render(
      <DayRibbon
        layout={{ ...LAYOUT, now: new Date("2026-08-16T05:00:00Z"), nowPosition: "after", nowPct: 100 }}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    expect(screen.getByText(/since Isha/)).toBeInTheDocument();
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  it("announces all prayers logged when nothing is left upcoming", () => {
    const allLogged: DayRibbonLayout = {
      ...LAYOUT,
      markers: LAYOUT.markers.map((m) => ({ ...m, state: "logged" as const })),
    };
    render(<DayRibbon layout={allLogged} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("All 5 prayers logged for today")).toBeInTheDocument();
  });
});
