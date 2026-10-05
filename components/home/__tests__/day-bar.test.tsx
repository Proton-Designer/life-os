import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: unknown = null;
const markPrayer = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock("@/app/(app)/deen/actions", () => ({ markPrayer: (...a: unknown[]) => markPrayer(...a), refreshDeenViews: vi.fn(async () => {}) }));
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

  it("an awake span up to a live NOW marker, with the efficiency share kept in the model", () => {
    render(<DayBar {...props} />);
    // 06:00→22:00 is 16 h; now 11:45 = 5.75 h = 35.9% ; focus share = 30% of that
    expect(screen.getByTestId("day-bar-awake-span").style.width).toMatch(/^35\.9/);
    expect(screen.getByTestId("day-bar-now").style.left).toMatch(/^35\.9/);
  });

  it("fixed events and focus blocks carry an icon (never colour-only); a legend names each with its time; focus is on the track and ringed; upcoming stays visible", () => {
    render(<DayBar {...props} />);
    const legend = within(screen.getByTestId("day-bar-legend"));
    for (const name of ["Calc", "Lock-In", "Gym"]) expect(legend.getByText(name)).toBeInTheDocument();
    const focus = screen.getByTestId("day-bar-focus-block");
    expect(focus.className).toContain("ring-1");
    expect(within(screen.getByTestId("day-bar-track")).getByTestId("day-bar-focus-block")).toBe(focus); // on the track
    const lanes = within(screen.getByTestId("day-bar-lanes"));
    expect(lanes.getAllByTestId("day-bar-block")).toHaveLength(2); // Calc + Gym sit in the lane ABOVE the track
    expect(lanes.getByRole("button", { name: /Class: Calculus, 10:00\sAM.11:00\sAM/ })).toBeInTheDocument();
    expect(focus).toHaveAccessibleName(/Focus: Lock-In/); // a thin segment: named, not iconed (the legend carries the icon)
    expect(within(screen.getByTestId("day-bar-legend")).getAllByText("Lock-In")[0].parentElement!.querySelector("svg")).not.toBeNull();
  });

  it("EVERY indicator opens a popover with its details: class, workout, focus block (and prayer, below)", async () => {
    vi.useRealTimers(); // popovers/sheets animate; findBy* needs real timers
    const user = userEvent.setup();
    render(<DayBar {...props} />);
    await user.click(screen.getByRole("button", { name: /Class: Calculus/ }));
    expect(await screen.findByTestId("indicator-popover")).toHaveTextContent("Calculus");
    expect(screen.getByTestId("indicator-time")).toHaveTextContent(/10:00\sAM.11:00\sAM/);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Workout: Gym/ }));
    expect(await screen.findByTestId("indicator-popover")).toHaveTextContent("Gym");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Focus: Lock-In/ }));
    expect(await screen.findByTestId("indicator-popover")).toHaveTextContent("Lock-In");
    expect(screen.getByTestId("indicator-time")).toHaveTextContent(/8:00\sAM.9:30\sAM/);
  });

  it("Faith on: the prayer window is a BAND spanning its whole window (current one stronger); the group names the day's ends", () => {
    render(<DayBar {...props} />);
    const band = screen.getByTestId("day-bar-prayer-dhuhr");
    // 13:00-15:30 of a 06:00-22:00 bar = 43.75% .. 59.4%
    expect(parseFloat(band.style.left)).toBeCloseTo(43.75, 1);
    expect(parseFloat(band.style.width)).toBeCloseTo(15.6, 1);
    expect(band).toHaveAttribute("data-current", "false"); // it is 11:45
    expect(band).toHaveAttribute("aria-label", expect.stringMatching(/Dhuhr window, 1:00\sPM.3:30\sPM \(logged\)/));
    expect(screen.getByRole("group", { name: /Your day from 6:00\sAM to 10:00\sPM/ })).toBeInTheDocument();
  });

  it("the window NOW falls in is marked current (positive control for the band above)", () => {
    vi.setSystemTime(at("2026-10-05T14:00:00"));
    render(<DayBar {...props} nowIso={at("2026-10-05T14:00:00").toISOString()} />);
    expect(screen.getByTestId("day-bar-prayer-dhuhr")).toHaveAttribute("data-current", "true");
  });

  it("Deen OFF: no prayer bands (a ribbon with no spans draws none)", () => {
    const noPrayer = computeDayRibbon({ dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") }, prayers: [], activities: [], now: at("2026-10-05T11:45:00") })!;
    render(<DayBar {...props} layout={noPrayer} />);
    expect(screen.queryByTestId("day-bar-prayer-dhuhr")).not.toBeInTheDocument();
  });

  it("a prayer popover shows the window and status, and 'Mark on time' (optimistic, then logged) for a not-yet-logged one", async () => {
    const pending = computeDayRibbon({
      dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
      prayers: [{ name: "asr", label: "Asr", status: "pending", window: { start: at("2026-10-05T11:00:00"), end: at("2026-10-05T14:00:00") } }],
      activities: [],
      now: at("2026-10-05T11:45:00"),
    })!;
    vi.useRealTimers(); // popovers/sheets animate; findBy* needs real timers
    const user = userEvent.setup();
    render(<DayBar {...props} layout={pending} />);
    await user.click(screen.getByTestId("day-bar-prayer-asr"));
    expect(await screen.findByTestId("indicator-popover")).toHaveTextContent("Status: Open now");
    await user.click(screen.getByTestId("mark-prayer-asr"));
    expect(screen.getByTestId("day-bar-prayer-asr")).toHaveAttribute("data-state", "logged"); // optimistic
    expect(markPrayer).toHaveBeenCalledWith("2026-10-05", "asr", "on_time");
  });

  it("on a phone the same indicator opens a BOTTOM SHEET instead of a popover", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.useRealTimers(); // popovers/sheets animate; findBy* needs real timers
    const user = userEvent.setup();
    render(<DayBar {...props} />);
    await user.click(await screen.findByRole("button", { name: /Class: Calculus/ }));
    const sheet = await screen.findByTestId("indicator-sheet");
    expect(sheet).toHaveTextContent("Calculus");
    expect(sheet.className).toContain("bottom-0");
    expect(screen.queryByTestId("indicator-popover")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("an hour scale runs along the bottom with a label every third hour", () => {
    render(<DayBar {...props} />);
    const scale = screen.getByTestId("day-bar-scale");
    expect(scale.children.length).toBeGreaterThanOrEqual(15); // 06:00..22:00 hourly
    expect(scale.textContent).toMatch(/6\sAM/);
    expect(scale.textContent).toMatch(/12\sPM/);
    expect(scale.textContent).not.toMatch(/7\sAM/);
  });

  // Lead's live finding: the wrappers above the bands swallowed every mouse/touch click on a prayer band.
  it("pointer-events: every wrapper above the prayer bands is pointer-events-none; only the actual buttons take pointer events", () => {
    render(<DayBar {...props} />);
    const chain = (el: HTMLElement) => {
      const out: string[] = [];
      for (let n: HTMLElement | null = el; n && n.getAttribute("data-testid") !== "day-bar-chart"; n = n.parentElement) out.push(n.className);
      return out;
    };
    const lanes = screen.getByTestId("day-bar-lanes");
    for (const el of [lanes, lanes.firstElementChild as HTMLElement, screen.getByTestId("day-bar-track"), screen.getByTestId("day-bar-blocks"), (screen.getByTestId("day-bar-blocks").firstElementChild as HTMLElement), screen.getByTestId("day-bar-awake-span").parentElement as HTMLElement]) {
      expect(el.className).toContain("pointer-events-none");
      expect(el.className).not.toContain("pointer-events-auto");
    }
    for (const b of [...screen.getAllByTestId("day-bar-block"), screen.getByTestId("day-bar-focus-block")]) expect(b.className).toContain("pointer-events-auto");
    // the band itself is in no pointer-events-none ancestor chain below the chart, and is not auto-blocked
    expect(chain(screen.getByTestId("day-bar-prayer-dhuhr")).some((c) => c.includes("pointer-events-none"))).toBe(false);
    // positive control for the helper: the lane wrapper chain DOES contain pointer-events-none
    expect(chain(screen.getAllByTestId("day-bar-block")[0]).some((c) => c.includes("pointer-events-none"))).toBe(true);
  });

  it("the NOW time label is not inside the track or the lanes (it cannot cover an event pill); it sits with the hour scale", () => {
    render(<DayBar {...props} />);
    const label = screen.getByTestId("day-bar-now-label");
    expect(label).toHaveTextContent("11:45 AM");
    expect(screen.getByTestId("day-bar-track")).not.toContainElement(label);
    expect(screen.getByTestId("day-bar-lanes")).not.toContainElement(label);
    expect(screen.getByTestId("day-bar-scale")).toContainElement(label);
    expect(screen.getByTestId("day-bar-now")).toHaveTextContent(""); // positive control: the line itself carries no text
  });

  it("only http(s) links render in a popover (a javascript: link is dropped; an https one is kept)", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const ev = (id: string, link: string) => ({ id, title: `Ev${id}`, startAt: at("2026-10-05T14:00:00"), endAt: at("2026-10-05T15:00:00"), link });
    const { unmount } = render(<DayBar {...props} calendarEvents={[ev("1", "javascript:alert(1)")]} />);
    await user.click(await screen.findByRole("button", { name: /Calendar: Ev1/ }));
    await screen.findByTestId("indicator-popover");
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    unmount();
    render(<DayBar {...props} calendarEvents={[ev("2", "https://example.com/e")]} />);
    await user.click(await screen.findByRole("button", { name: /Calendar: Ev2/ }));
    expect(await screen.findByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/e");
  });

  it("a dot at the very start or end of the bar is inset so it is not half-clipped", () => {
    const edge = (iso: string) => ({ id: iso, title: "Edge", startAt: at(iso), endAt: new Date(at(iso).getTime() + 60_000) });
    render(<DayBar {...props} calendarEvents={[edge("2026-10-05T06:00:00"), edge("2026-10-05T21:59:30")]} />);
    const lefts = screen.getAllByTestId("day-bar-dot").map((d) => parseFloat(d.style.left));
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(2.5);
    expect(Math.max(...lefts)).toBeLessThanOrEqual(97.5);
    expect(lefts.length).toBe(2); // positive control: both really rendered as dots
  });

  // DAYBAR-03: the whole day, a Start Day marker, a thin separate prayer strip, an empty state.
  describe("DAYBAR-03 whole-day layouts", () => {
    const dayStart = at("2026-10-05T00:00:00").toISOString();
    const dayEnd = at("2026-10-06T00:00:00").toISOString();
    const whole = { ...props, rangeStartIso: dayStart, endIso: dayEnd };
    const prayerLayout = (events: boolean) =>
      computeDayRibbon({
        dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
        prayers: [
          { name: "maghrib", label: "Maghrib", status: "pending", window: { start: at("2026-10-05T18:30:00"), end: at("2026-10-05T20:00:00") } },
          { name: "isha", label: "Isha", status: "upcoming", window: { start: at("2026-10-05T20:00:00"), end: at("2026-10-05T23:30:00") } },
        ],
        activities: events ? [{ label: "Calc", colorVar: "--accent-school", kind: "class", start: at("2026-10-05T10:00:00"), end: at("2026-10-05T11:15:00") }] : [],
        now: at("2026-10-05T19:55:00"),
      })!;
    const lateStart = { ...whole, layout: prayerLayout(false), wokeAtIso: at("2026-10-05T19:50:00").toISOString(), nowIso: at("2026-10-05T19:55:00").toISOString() };

    it("A (late Start Day, Deen ON, nothing scheduled): a 24 h bar with the Started marker at 7:50 PM, awake shading from it to NOW, thin prayer strip, empty note", () => {
      vi.setSystemTime(at("2026-10-05T19:55:00"));
      render(<DayBar {...lateStart} />);
      const started = parseFloat(screen.getByTestId("day-bar-started").style.left);
      expect(started).toBeCloseTo((19 + 50 / 60) / 24 * 100, 1);
      // Started lives under the Awake headline (never on the scale, where it collided with NOW); the scale only carries NOW
      expect(screen.getByTestId("day-bar-started-label")).toHaveTextContent("Started 7:50 PM");
      expect(screen.getByTestId("day-bar-awake").parentElement).toContainElement(screen.getByTestId("day-bar-started-label"));
      expect(screen.getByTestId("day-bar-scale")).not.toContainElement(screen.getByTestId("day-bar-started-label"));
      expect(screen.getByTestId("day-bar-now-label")).toHaveTextContent("now 7:55 PM");
      expect(screen.queryByTestId("day-bar-started-now-label")).not.toBeInTheDocument();
      const span = screen.getByTestId("day-bar-awake-span");
      expect(parseFloat(span.style.left)).toBeCloseTo(started, 1); // shading starts at the marker...
      expect(parseFloat(span.style.left) + parseFloat(span.style.width)).toBeCloseTo(parseFloat(screen.getByTestId("day-bar-now").style.left), 1); // ...and ends at NOW
      expect(screen.getByTestId("day-bar-asleep")).toBeInTheDocument(); // the part before Start Day is faint
      expect(screen.getByTestId("day-bar-empty")).toBeInTheDocument();
      // prayers live in a separate strip, thin, never a full-height box in the track
      const strip = screen.getByTestId("day-bar-prayer-strip");
      expect(strip).toContainElement(screen.getByTestId("day-bar-prayer-maghrib"));
      expect(screen.getByTestId("day-bar-track")).not.toContainElement(screen.getByTestId("day-bar-prayer-maghrib"));
      expect(screen.getByTestId("day-bar-track").style.height).toBe("12px");
      // 3-hourly labels over the whole day
      const scale = screen.getByTestId("day-bar-scale").textContent!;
      for (const l of ["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]) expect(scale).toContain(l);
    });

    it("no marker and no awake shading before Start Day (positive control: A has both)", () => {
      vi.setSystemTime(at("2026-10-05T07:00:00"));
      render(<DayBar {...lateStart} nowIso={at("2026-10-05T07:00:00").toISOString()} />);
      expect(screen.queryByTestId("day-bar-started")).not.toBeInTheDocument();
      expect(screen.queryByTestId("day-bar-started-label")).not.toBeInTheDocument();
      expect(parseFloat(screen.getByTestId("day-bar-awake-span").style.width)).toBe(0);
    });

    it("B (morning, class + focus block): the class is a pill in a lane, the focus block a segment on the track, no empty note", () => {
      vi.setSystemTime(at("2026-10-05T14:00:00"));
      render(
        <DayBar {...whole} layout={computeDayRibbon({
          dayBounds: { start: at("2026-10-05T05:00:00"), end: at("2026-10-05T23:00:00") },
          prayers: [],
          activities: [
            { label: "Calc", colorVar: "--accent-school", kind: "class", start: at("2026-10-05T10:00:00"), end: at("2026-10-05T11:15:00") },
            { label: "Lock-In", colorVar: "--accent-business", kind: "focus", start: at("2026-10-05T12:00:00"), end: at("2026-10-05T12:45:00") },
          ],
          now: at("2026-10-05T14:00:00"),
        })!} wokeAtIso={at("2026-10-05T07:00:00").toISOString()} nowIso={at("2026-10-05T14:00:00").toISOString()} />
      );
      expect(within(screen.getByTestId("day-bar-lanes")).getByRole("button", { name: /Class: Calc/ })).toBeInTheDocument();
      expect(within(screen.getByTestId("day-bar-track")).getByTestId("day-bar-focus-block")).toBeInTheDocument();
      expect(screen.queryByTestId("day-bar-empty")).not.toBeInTheDocument();
      // 7 AM and 2 PM are 29% apart: two labels, each its own element (positive control for the combined rule above)
      expect(screen.getByTestId("day-bar-started-label")).toHaveTextContent("Started 7:00 AM");
      expect(screen.getByTestId("day-bar-now-label")).toHaveTextContent("2:00 PM");
      expect(screen.queryByTestId("day-bar-started-now-label")).not.toBeInTheDocument();
    });

    it("C (Deen OFF, no events): no prayer strip, the empty note, still a whole-day bar with Started + NOW", () => {
      vi.setSystemTime(at("2026-10-05T11:45:00"));
      render(<DayBar {...whole} layout={null} />);
      expect(screen.queryByTestId("day-bar-prayer-strip")).not.toBeInTheDocument();
      expect(screen.getByTestId("day-bar-empty")).toBeInTheDocument();
      expect(screen.getByTestId("day-bar-started")).toBeInTheDocument();
      expect(screen.getByTestId("day-bar-now")).toBeInTheDocument();
    });

    it("D (Start Day at 1 AM): the marker sits near the left edge and its label is kept inside the chart", () => {
      vi.setSystemTime(at("2026-10-05T01:30:00"));
      render(<DayBar {...whole} layout={null} wokeAtIso={at("2026-10-05T01:00:00").toISOString()} nowIso={at("2026-10-05T01:30:00").toISOString()} />);
      expect(parseFloat(screen.getByTestId("day-bar-started").style.left)).toBeCloseTo(4.17, 1);
      expect(screen.getByTestId("day-bar-started-label")).toHaveTextContent("Started 1:00 AM"); // under the Awake headline, so no edge to spill off
      const label = screen.getByTestId("day-bar-now-label"); // NOW is near the left edge: left-aligned so it cannot spill off
      expect(label).toHaveTextContent("now 1:30 AM");
      expect(label.className).not.toContain("-translate-x-");
    });

    it("prayer strip segments carry their window geometry and the current one is highlighted; a too-narrow name is abbreviated to 3 letters", async () => {
      vi.setSystemTime(at("2026-10-05T19:55:00"));
      render(<DayBar {...lateStart} />);
      const maghrib = screen.getByTestId("day-bar-prayer-maghrib");
      expect(maghrib).toHaveAttribute("data-current", "true");
      expect(parseFloat(maghrib.style.left)).toBeCloseTo(((18 + 30 / 60) / 24) * 100, 1);
      expect(maghrib).toHaveTextContent("Mag"); // 6.25% of the bar cannot carry "Maghrib" but fits 3 letters
      expect(screen.getByTestId("day-bar-prayer-isha")).toHaveAttribute("data-current", "false");
    });

    it("on a phone: only the CURRENT prayer is named (no stray initials; the others stay tappable) and the scale labels only every 6 h", () => {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
      vi.setSystemTime(at("2026-10-05T19:55:00"));
      render(<DayBar {...lateStart} />);
      expect(screen.getByTestId("day-bar-prayer-maghrib")).toHaveTextContent(/^Maghrib$/);
      expect(screen.getByTestId("day-bar-prayer-isha")).toHaveTextContent(/^$/);
      expect(screen.getByTestId("day-bar-prayer-isha")).toBeEnabled();
      const scale = screen.getByTestId("day-bar-scale").textContent!;
      expect(scale).toContain("6 AM");
      expect(scale).not.toContain("3 AM");
      vi.unstubAllGlobals();
    });
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

  it("with no ribbon it is still a bar, with a one-line empty note", () => {
    render(<DayBar {...props} layout={null} />);
    expect(screen.getByTestId("day-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("day-bar-legend")).not.toBeInTheDocument();
    expect(screen.getByTestId("day-bar-empty")).toHaveTextContent("Nothing scheduled today");
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
      activities: [{ label: "Late", colorVar: "--accent-school", kind: "work", start: at("2026-10-05T21:00:00"), end: at("2026-10-05T23:30:00") }],
      now: at("2026-10-05T11:45:00"),
    })!;
    render(<DayBar {...props} layout={edge} />);
    const pill = within(screen.getByTestId("day-bar-lanes")).getByTestId("day-bar-block");
    expect(parseFloat(pill.style.left) + parseFloat(pill.style.width)).toBeLessThanOrEqual(100.0001); // fits in the bar
    expect(screen.getByTestId("day-bar-lanes").className).toContain("overflow-hidden"); // and anything left over is clipped
  });
});
