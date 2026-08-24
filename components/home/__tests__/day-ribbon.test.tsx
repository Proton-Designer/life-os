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
const RANGE_END = new Date("2026-08-16T09:00:00Z");

const LAYOUT: DayRibbonLayout = {
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  now: new Date("2026-08-15T17:00:00Z"),
  nowPct: 40,
  nowPosition: "within",
  spans: [
    {
      name: "fajr",
      label: "Fajr",
      status: "on_time",
      state: "logged",
      startPct: 0,
      endPct: 10,
      windowStart: RANGE_START,
      windowEnd: new Date("2026-08-15T11:30:00Z"),
      labelRow: 0,
    },
    {
      name: "dhuhr",
      label: "Dhuhr",
      status: "pending",
      state: "pending",
      startPct: 35,
      endPct: 60,
      windowStart: new Date("2026-08-15T16:56:00Z"),
      windowEnd: new Date("2026-08-15T20:49:00Z"),
      labelRow: 0,
    },
    {
      name: "asr",
      label: "Asr",
      status: "missed",
      state: "missed",
      startPct: 60,
      endPct: 75,
      windowStart: new Date("2026-08-15T20:49:00Z"),
      windowEnd: new Date("2026-08-15T23:59:00Z"),
      labelRow: 0,
    },
    {
      name: "maghrib",
      label: "Maghrib",
      status: "upcoming",
      state: "upcoming",
      startPct: 75,
      endPct: 85,
      windowStart: new Date("2026-08-16T00:59:00Z"),
      windowEnd: new Date("2026-08-16T02:40:00Z"),
      labelRow: 1,
    },
    {
      name: "isha",
      label: "Isha",
      status: "upcoming",
      state: "upcoming",
      startPct: 85,
      endPct: 100,
      windowStart: new Date("2026-08-16T02:40:00Z"),
      windowEnd: RANGE_END,
      labelRow: 0,
    },
  ],
  blocks: [{ label: "Deep work", colorVar: "--series-business", kind: "focus", startPct: 10, endPct: 30 }],
};

describe("DayRibbon", () => {
  it("renders every prayer span with its label", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByText("Dhuhr")).toBeInTheDocument();
    expect(screen.getByText("Asr")).toBeInTheDocument();
    expect(screen.getByText("Maghrib")).toBeInTheDocument();
    expect(screen.getByText("Isha")).toBeInTheDocument();
  });

  it("renders each span as a real width (start to end), not a single point", () => {
    const { container } = render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    const dhuhrSpan = container.querySelector('[data-testid="ribbon-span-dhuhr"]') as HTMLElement;
    expect(dhuhrSpan).toBeTruthy();
    expect(dhuhrSpan.style.left).toBe("35%");
    expect(dhuhrSpan.style.width).toBe("25%");
  });

  it("marks each span's visual state distinctly via data-state, including the live 'pending' state", () => {
    const { container } = render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(container.querySelector('[data-testid="ribbon-span-fajr"]')).toHaveAttribute("data-state", "logged");
    expect(container.querySelector('[data-testid="ribbon-span-dhuhr"]')).toHaveAttribute("data-state", "pending");
    expect(container.querySelector('[data-testid="ribbon-span-asr"]')).toHaveAttribute("data-state", "missed");
    expect(container.querySelector('[data-testid="ribbon-span-maghrib"]')).toHaveAttribute("data-state", "upcoming");
  });

  it("marks a prayer on-time when its label is clicked", async () => {
    const user = userEvent.setup();
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    await user.click(screen.getByRole("button", { name: /Dhuhr/ }));
    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-15", "dhuhr", "on_time");
  });

  it("headlines the currently-open window when one prayer is pending", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/Dhuhr is open now/)).toBeInTheDocument();
  });

  it("headlines the next upcoming prayer when nothing is currently pending", () => {
    const noPending: DayRibbonLayout = {
      ...LAYOUT,
      spans: LAYOUT.spans.map((s) => (s.name === "dhuhr" ? { ...s, state: "upcoming" as const } : s)),
    };
    render(<DayRibbon layout={noPending} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/Next: Dhuhr/)).toBeInTheDocument();
  });

  it("announces the day as accounted for when nothing is pending or upcoming (all logged/missed)", () => {
    const allSettled: DayRibbonLayout = {
      ...LAYOUT,
      spans: LAYOUT.spans.map((s) => (s.state === "pending" || s.state === "upcoming" ? { ...s, state: "logged" as const } : s)),
    };
    render(<DayRibbon layout={allSettled} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/accounted for/)).toBeInTheDocument();
  });

  it("shows the wider empty-state invitation (workout, tasks, focus sessions) when there are no activity blocks yet", () => {
    render(<DayRibbon layout={{ ...LAYOUT, blocks: [] }} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.getByText(/workout|tasks|focus sessions/i)).toBeInTheDocument();
  });

  it("renders no empty activity track — an inert full-width pill with nothing in it reads as a stray scrollbar", () => {
    const { container } = render(
      <DayRibbon layout={{ ...LAYOUT, blocks: [] }} todayStr="2026-08-15" timezone="UTC" />
    );
    expect(container.querySelector(".bg-background\\/30")).not.toBeInTheDocument();
  });

  it("omits the invitation line once real activity exists", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    expect(screen.queryByText(/workout, tasks, or focus sessions/i)).not.toBeInTheDocument();
  });

  it("renders a live on-track 'now' indicator when now falls within range", () => {
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
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  it("shows a 'day complete' headline after the range ends, not a silently-clamped indicator", () => {
    render(
      <DayRibbon
        layout={{ ...LAYOUT, now: new Date("2026-08-16T10:00:00Z"), nowPosition: "after", nowPct: 100 }}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  // Overnight session 2026-08-23/24 — a block only becomes clickable when
  // it carries a detail payload; one with nothing to show must render as
  // plain, non-interactive chrome rather than a dead affordance.
  it("opens a detail popover when a block with a detail payload is clicked", async () => {
    const user = userEvent.setup();
    const withDetail: DayRibbonLayout = {
      ...LAYOUT,
      blocks: [
        {
          label: "CS-3341-HON",
          colorVar: "--series-school",
          kind: "class",
          startPct: 10,
          endPct: 30,
          detail: { title: "CS-3341-HON", timeRange: "8:30 AM–9:45 AM", location: "ECSN 2.120", instructor: "N. Ruozzi", domain: "school" },
        },
      ],
    };
    render(<DayRibbon layout={withDetail} todayStr="2026-08-15" timezone="UTC" />);

    await user.click(screen.getByRole("button", { name: /CS-3341-HON, 8:30 AM–9:45 AM/ }));
    expect(screen.getByText("ECSN 2.120")).toBeInTheDocument();
    expect(screen.getByText("N. Ruozzi")).toBeInTheDocument();
  });

  it("renders a block with no detail as non-interactive — no button role at all", () => {
    render(<DayRibbon layout={LAYOUT} todayStr="2026-08-15" timezone="UTC" />);
    // LAYOUT's one block ("Deep work") carries no detail — only the five
    // prayer-mark buttons should exist, none for the activity block.
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
