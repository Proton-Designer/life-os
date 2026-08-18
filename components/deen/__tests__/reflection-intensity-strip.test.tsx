import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildReflectionStrip } from "@/lib/deen/reflection-strip";
import { ReflectionIntensityStrip } from "../reflection-intensity-strip";

describe("ReflectionIntensityStrip", () => {
  it("shows the clear-days headline, not a streak", () => {
    const days = buildReflectionStrip([{ date: "2026-08-30", tier: 1 }], "2026-08-30");
    render(<ReflectionIntensityStrip days={days} />);
    expect(screen.getByText("29 of the last 30 days clear")).toBeInTheDocument();
  });

  it("renders one cell per day", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    const { container } = render(<ReflectionIntensityStrip days={days} />);
    expect(container.querySelectorAll('[data-testid="reflection-strip-cell"]')).toHaveLength(30);
  });

  it("gives each cell its own bucket for a single-hue intensity ramp, distinguishable from a clear day", () => {
    const days = buildReflectionStrip(
      [
        { date: "2026-08-30", tier: 3 },
        { date: "2026-08-30", tier: 3 },
        { date: "2026-08-30", tier: 3 },
      ],
      "2026-08-30"
    );
    const { container } = render(<ReflectionIntensityStrip days={days} />);
    const heavyCell = container.querySelector('[data-date="2026-08-30"]');
    const clearCell = container.querySelector('[data-date="2026-08-29"]');
    expect(heavyCell).toHaveAttribute("data-bucket", "high");
    expect(clearCell).toHaveAttribute("data-bucket", "clear");
  });

  it("shows a dated axis — the start and end dates of the window are visible", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    render(<ReflectionIntensityStrip days={days} />);
    expect(screen.getByText(/Aug 1/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 30/)).toBeInTheDocument();
  });

  it("labels each cell with its own date for hover/screen-reader detail", () => {
    const days = buildReflectionStrip([{ date: "2026-08-15", tier: 2 }], "2026-08-30");
    const { container } = render(<ReflectionIntensityStrip days={days} />);
    const cell = container.querySelector('[data-date="2026-08-15"]');
    expect(cell?.getAttribute("aria-label")).toMatch(/Aug 15/);
  });

  it("marks an empty today as in-progress, visually distinct from a clear day — hollow/outlined/static, matching the habit grid's own in-progress treatment, never claims a verdict the day hasn't earned yet", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    const { container } = render(<ReflectionIntensityStrip days={days} />);
    const todayCell = container.querySelector('[data-date="2026-08-30"]');
    expect(todayCell).toHaveAttribute("data-bucket", "in_progress");
    // Lead's ruling (2026-08-18): a pulse-only signal fails under
    // prefers-reduced-motion — a dense grid can carry several in-progress
    // cells at once, unlike day-ribbon's single "now", so the state can't
    // depend on animation here. Static hollow border instead, same recipe
    // ConsistencyGrid's "hollow" treatment already uses (lib/charts/consistency-style.ts).
    expect(todayCell?.className).not.toMatch(/animate-pulse/);
    const style = (todayCell as HTMLElement).style;
    expect(style.backgroundColor).toBe("transparent");
    expect(style.border).toMatch(/muted-foreground/);
    expect(todayCell?.getAttribute("aria-label")).toMatch(/in progress/i);
  });

  it("doesn't count an in-progress today toward the clear headline", () => {
    const days = buildReflectionStrip([], "2026-08-30");
    render(<ReflectionIntensityStrip days={days} />);
    expect(screen.getByText("29 of the last 30 days clear")).toBeInTheDocument();
  });
});
