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

  // 2026-08-25/26 batch 2, item 1a: the subtitle is now a plain schedule
  // summary (classes + work), not prayer-status narration — Ayman's own
  // worked examples, followed exactly.
  describe("schedule summary subtitle", () => {
    it("shows 'Nothing scheduled today' with no class/work blocks at all", () => {
      const noEvents: DayRibbonLayout = { ...LAYOUT, blocks: [] };
      render(<DayRibbon layout={noEvents} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("Nothing scheduled today")).toBeInTheDocument();
    });

    it("counts a single class, singular: 'You have 1 class today'", () => {
      const oneClass: DayRibbonLayout = {
        ...LAYOUT,
        blocks: [{ label: "CS-3341-HON", colorVar: "--series-school", kind: "class", startPct: 10, endPct: 20 }],
      };
      render(<DayRibbon layout={oneClass} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("You have 1 class today")).toBeInTheDocument();
    });

    it("counts multiple classes, plural: 'You have 3 classes today' (Ayman's own Tuesday example)", () => {
      const threeClasses: DayRibbonLayout = {
        ...LAYOUT,
        blocks: [
          { label: "CS-3345-HON", colorVar: "--series-school", kind: "class", startPct: 10, endPct: 20 },
          { label: "PHYS-2326-002", colorVar: "--series-school", kind: "class", startPct: 30, endPct: 40 },
          { label: "AMS-2341-HN1", colorVar: "--series-school", kind: "class", startPct: 50, endPct: 60 },
        ],
      };
      render(<DayRibbon layout={threeClasses} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("You have 3 classes today")).toBeInTheDocument();
    });

    it("combines a class with work: 'You have 1 class and work today' (Ayman's own Monday example)", () => {
      const classAndWork: DayRibbonLayout = {
        ...LAYOUT,
        blocks: [
          { label: "CS-3341-HON", colorVar: "--series-school", kind: "class", startPct: 10, endPct: 20 },
          { label: "Work", colorVar: "--series-coop", kind: "work", startPct: 30, endPct: 60 },
        ],
      };
      render(<DayRibbon layout={classAndWork} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("You have 1 class and work today")).toBeInTheDocument();
    });

    it("shows work alone when there's work but no classes: 'You have work today'", () => {
      const workOnly: DayRibbonLayout = {
        ...LAYOUT,
        blocks: [{ label: "Work", colorVar: "--series-coop", kind: "work", startPct: 30, endPct: 60 }],
      };
      render(<DayRibbon layout={workOnly} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("You have work today")).toBeInTheDocument();
    });

    it("never counts fitness, task, or focus blocks as a 'main event' — only class/work", () => {
      const nonMainOnly: DayRibbonLayout = {
        ...LAYOUT,
        blocks: [
          { label: "Push Day", colorVar: "--series-fitness", kind: "fitness", startPct: 10, endPct: 20 },
          { label: "Essay due", colorVar: "--series-school", kind: "task", startPct: 30, endPct: 32 },
          { label: "Deep Work", colorVar: "--series-business", kind: "focus", startPct: 40, endPct: 50 },
        ],
      };
      render(<DayRibbon layout={nonMainOnly} todayStr="2026-08-15" timezone="UTC" />);
      expect(screen.getByText("Nothing scheduled today")).toBeInTheDocument();
    });
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

  // The subtitle is a static schedule summary now (item 1a) and no longer
  // varies with nowPosition, but the live on-track "now" marker itself
  // (a separate feature) still must not render outside the range —
  // covered here independent of subtitle text.
  it("hides the 'now' marker before the range starts, not a silently-clamped indicator", () => {
    render(
      <DayRibbon
        layout={{ ...LAYOUT, now: new Date("2026-08-15T08:00:00Z"), nowPosition: "before", nowPct: 0 }}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  it("hides the 'now' marker after the range ends, not a silently-clamped indicator", () => {
    render(
      <DayRibbon
        layout={{ ...LAYOUT, now: new Date("2026-08-16T10:00:00Z"), nowPosition: "after", nowPct: 100 }}
        todayStr="2026-08-15"
        timezone="UTC"
      />
    );
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

  // 2026-08-25/26 batch 2, item 1b (Lead review): the tap target and the
  // painted width are two different numbers now — a short block must still
  // be paintable at its true thin proportional width while its BUTTON
  // (the thing a thumb actually has to hit) never shrinks below a real
  // tap-target floor.
  describe("interactive block: tap-target floor decoupled from painted width", () => {
    function detailBlock(startPct: number, endPct: number) {
      return {
        label: "CS-3341-HON",
        colorVar: "--series-school",
        kind: "class" as const,
        startPct,
        endPct,
        detail: { title: "CS-3341-HON", timeRange: "8:30 AM–9:45 AM", domain: "school" },
      };
    }

    it("a very short block's BUTTON never shrinks below the 24px/640px (3.75%) tap-target floor", () => {
      // 1% wide (well under the floor) — e.g. a 15-minute task on a ~24h track.
      const { container } = render(
        <DayRibbon layout={{ ...LAYOUT, blocks: [detailBlock(40, 41)] }} todayStr="2026-08-15" timezone="UTC" />
      );
      const button = screen.getByRole("button", { name: /CS-3341-HON/ });
      const widthPct = parseFloat(button.style.width);
      expect(widthPct).toBeCloseTo(3.75, 2);

      // Centered on the block's own true midpoint (40.5%), not left-anchored.
      const leftPct = parseFloat(button.style.left);
      expect(leftPct).toBeCloseTo(40.5 - 3.75 / 2, 2);

      // The painted pill stays at the true, thin, proportional width —
      // never inflated to match the expanded tap target.
      const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(pill).toBeTruthy();
      expect(parseFloat(pill.style.width)).toBeCloseTo(1, 2);
      expect(pill.style.left).toBe("40%");
    });

    it("a long block's tap target and painted width are the same — no artificial expansion above the floor", () => {
      const { container } = render(
        <DayRibbon layout={{ ...LAYOUT, blocks: [detailBlock(10, 20)] }} todayStr="2026-08-15" timezone="UTC" />
      );
      const button = screen.getByRole("button", { name: /CS-3341-HON/ });
      const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(parseFloat(button.style.width)).toBeCloseTo(10, 2);
      expect(parseFloat(pill.style.width)).toBeCloseTo(10, 2);
      expect(button.style.left).toBe(pill.style.left);
    });

    it("drops the icon (not a half-clipped one) on a block too narrow to hold it — identity still lives in aria-label", () => {
      // ~2% wide — under the ~4.06% (26px/640px) icon-content floor, but
      // above 0 — a real, if narrow, painted block.
      const { container } = render(
        <DayRibbon layout={{ ...LAYOUT, blocks: [detailBlock(40, 42)] }} todayStr="2026-08-15" timezone="UTC" />
      );
      const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(pill.querySelector("svg")).toBeNull();
      // The button itself still carries the full accessible name regardless.
      expect(screen.getByRole("button", { name: /CS-3341-HON, 8:30 AM–9:45 AM/ })).toBeInTheDocument();
    });

    it("keeps the icon on a block wide enough to hold it without clipping", () => {
      const { container } = render(
        <DayRibbon layout={{ ...LAYOUT, blocks: [detailBlock(10, 20)] }} todayStr="2026-08-15" timezone="UTC" />
      );
      const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(pill.querySelector("svg")).not.toBeNull();
    });

    it("clicking anywhere in the expanded (invisible) hit area still opens the popover, not just the painted pixels", async () => {
      const user = userEvent.setup();
      render(<DayRibbon layout={{ ...LAYOUT, blocks: [detailBlock(40, 41)] }} todayStr="2026-08-15" timezone="UTC" />);
      // The button IS the hit area (the pill is pointer-events-none and
      // purely decorative) — clicking the button by its accessible role,
      // exactly as a real tap would land anywhere in its (wider) box.
      await user.click(screen.getByRole("button", { name: /CS-3341-HON/ }));
      expect(screen.getByText("8:30 AM–9:45 AM")).toBeInTheDocument();
    });
  });
});
