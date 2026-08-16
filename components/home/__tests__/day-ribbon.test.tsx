import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";

const markPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
}));

import { DayRibbon } from "../day-ribbon";

const LAYOUT: DayRibbonLayout = {
  rangeStart: new Date("2026-08-15T10:12:00Z"),
  rangeEnd: new Date("2026-08-16T02:40:00Z"),
  nowPct: 40,
  markers: [
    { name: "fajr", label: "Fajr", time: new Date("2026-08-15T10:12:00Z"), pct: 0, state: "logged" },
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

  it("renders an empty-day message when there are no activity blocks", () => {
    render(<DayRibbon layout={{ ...LAYOUT, blocks: [] }} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("Nothing logged yet today")).toBeInTheDocument();
  });

  it("renders a live 'now' indicator", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("now")).toBeInTheDocument();
  });
});
