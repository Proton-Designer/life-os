import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: unknown = null;
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session }) }));

import { DayBar } from "../day-bar";
import { computeDayRibbon } from "@/lib/home/day-ribbon";

const at = (l: string) => new Date(`${l}-05:00`);
const layout = computeDayRibbon({
  dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
  prayers: [
    { name: "dhuhr", label: "Dhuhr", status: "on_time", window: { start: at("2026-10-05T13:00:00"), end: at("2026-10-05T15:30:00") } },
  ],
  activities: [
    { label: "Calc", colorVar: "--accent-school", kind: "class", start: at("2026-10-05T10:00:00"), end: at("2026-10-05T11:00:00"), detail: { title: "Calculus", timeRange: "10:00–11:00", domain: "school" } },
    { label: "Lock-In", colorVar: "--accent-business", kind: "focus", start: at("2026-10-05T08:00:00"), end: at("2026-10-05T09:30:00") },
    { label: "Gym", colorVar: "--accent-fitness", kind: "fitness", start: at("2026-10-05T18:00:00"), end: at("2026-10-05T19:00:00") },
  ],
  now: at("2026-10-05T11:45:00"),
})!;

const props = {
  layout,
  wokeAtIso: at("2026-10-05T06:00:00").toISOString(),
  endIso: at("2026-10-05T22:00:00").toISOString(),
  nowIso: at("2026-10-05T11:45:00").toISOString(),
  hoursTodayMinutes: 90,
  targetMinutes: 240,
  efficiencyPercent: 30,
  timezone: "America/Chicago",
  localDate: "2026-10-05",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at("2026-10-05T11:45:00")); // awake 5:45
  session = null;
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("DayBar (HOME-02)", () => {
  it("labels: 'Awake for 5:45', 'Focus 1:30 · 1 of 4 h · 2:30 to go', '30% focused'", () => {
    render(<DayBar {...props} />);
    expect(screen.getByTestId("day-bar-awake")).toHaveTextContent("Awake for 5:45");
    expect(screen.getByTestId("day-bar-focus")).toHaveTextContent("Focus 1:30 · 1 of 4 h · 2:30 to go");
    expect(screen.getByTestId("day-bar-efficiency")).toHaveTextContent("30% focused");
  });

  it("the 'to go' part disappears once the target is met (positive control: 90 min shows it)", () => {
    const { unmount } = render(<DayBar {...props} />);
    expect(screen.getByTestId("day-bar-focus")).toHaveTextContent("to go");
    unmount();
    render(<DayBar {...props} hoursTodayMinutes={250} />);
    expect(screen.getByTestId("day-bar-focus")).not.toHaveTextContent("to go");
    expect(screen.getByTestId("day-bar-focus")).toHaveTextContent("Focus 4:10");
  });

  it("the Awake-for label ticks with the clock", () => {
    render(<DayBar {...props} />);
    act(() => void vi.advanceTimersByTime(15 * 60 * 1000));
    expect(screen.getByTestId("day-bar-awake")).toHaveTextContent("Awake for 6:00");
  });

  it("an awake span up to a live NOW marker, with the efficiency strip inside it", () => {
    render(<DayBar {...props} />);
    // 06:00→22:00 is 16 h; now 11:45 = 5.75 h = 35.9% ; focus share = 30% of that
    expect(screen.getByTestId("day-bar-awake-span").style.width).toMatch(/^35\.9/);
    expect(parseFloat(screen.getByTestId("day-bar-focus-share").style.width)).toBeCloseTo(10.78, 1);
    expect(screen.getByTestId("day-bar-now").style.left).toMatch(/^35\.9/);
  });

  it("blocks carry icon + label (never colour-only): a legend names each with its time; focus is highlighted; upcoming stays visible", () => {
    render(<DayBar {...props} />);
    const legend = within(screen.getByTestId("day-bar-legend"));
    for (const name of ["Calc", "Lock-In", "Gym"]) expect(legend.getByText(name)).toBeInTheDocument();
    expect(screen.getByTestId("day-bar-focus-block").className).toContain("ring-2");
    expect(screen.getAllByTestId("day-bar-block").length).toBe(2); // Calc + Gym (the class and what's left of the day)
    expect(screen.getByRole("button", { name: /Class: Calculus, 10:00–11:00/ })).toBeInTheDocument(); // popover trigger kept
  });

  it("shows the prayer window as a marker when Faith is on, and the wake/bedtime ends of the bar", () => {
    render(<DayBar {...props} />);
    expect(screen.getByTestId("day-bar-prayer-dhuhr")).toHaveAttribute("aria-label", "Dhuhr (logged)");
    expect(screen.getByRole("img", { name: /Your day from 6:00 AM to 10:00 PM/ })).toBeInTheDocument();
  });

  it("the subtle Lock-In hint sits under the bar while hours are 0 (and not otherwise)", () => {
    const { unmount } = render(<DayBar {...props} hoursTodayMinutes={0} efficiencyPercent={null} />);
    act(() => void vi.advanceTimersByTime(10));
    expect(screen.getByTestId("lock-in-hint")).toBeInTheDocument();
    expect(screen.getByTestId("day-bar-efficiency")).toHaveTextContent("— focused");
    unmount();
    render(<DayBar {...props} hoursTodayMinutes={30} />);
    expect(screen.queryByTestId("lock-in-hint")).not.toBeInTheDocument();
  });

  it("with no ribbon it is still a bar, with a gentle empty line", () => {
    render(<DayBar {...props} layout={null} />);
    expect(screen.getByTestId("day-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("day-bar-legend")).not.toBeInTheDocument();
    expect(screen.getByText(/will show up here as your day happens/)).toBeInTheDocument();
  });

  // eng1 review L1: seeded from the SERVER's now, so server HTML and first client paint agree.
  it("the first render uses the server-computed nowIso (not the client clock), so there is no mismatch or width jump", () => {
    vi.setSystemTime(at("2026-10-05T16:00:00")); // the client clock disagrees with the server's now
    render(<DayBar {...props} />);
    expect(screen.getByTestId("day-bar-awake")).toHaveTextContent("Awake for 5:45"); // from nowIso 11:45, not 10:00
    expect(screen.getByTestId("day-bar-now").style.left).toMatch(/^35\.9/);
    act(() => void vi.advanceTimersByTime(1000)); // the first tick adopts the real clock
    expect(screen.getByTestId("day-bar-awake")).toHaveTextContent("Awake for 10:00");
  });

  // eng1 review L6: nothing may overhang the end of the bar.
  it("a block at the very end of the day cannot overhang the bar", () => {
    const edge = computeDayRibbon({
      dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
      prayers: [],
      activities: [{ label: "Late", colorVar: "--accent-school", kind: "work", start: at("2026-10-05T21:50:00"), end: at("2026-10-05T23:30:00") }],
      now: at("2026-10-05T11:45:00"),
    })!;
    render(<DayBar {...props} layout={edge} />);
    const pill = screen.getByTestId("day-bar-block");
    expect(parseFloat(pill.style.left) + parseFloat(pill.style.width)).toBeLessThanOrEqual(100.0001); // fits in the bar
    expect(screen.getByTestId("day-bar-blocks").className).toContain("overflow-hidden"); // and anything left over is clipped
  });
});
