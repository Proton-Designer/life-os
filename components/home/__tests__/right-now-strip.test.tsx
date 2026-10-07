import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriorityItem } from "@/lib/home/types";
import type { HomeNowItem } from "@/lib/quran/surfaces";

const toggle = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const logQuranReading = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/actions", () => ({ toggleItem: (...a: unknown[]) => toggle(...a) }));
vi.mock("@/app/(app)/deen/actions", () => ({ setSunnah: vi.fn(async () => {}) }));
vi.mock("@/app/(app)/deen/quran-plan-actions", () => ({ logQuranReading: (...a: unknown[]) => logQuranReading(...a) }));
vi.mock("@/components/home/use-home-refresh", () => ({ useHomeRefresh: () => () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { RightNowStrip } from "../right-now-strip";

const TZ = "America/Chicago"; // UTC-5 in October (CDT)
// Local 6:00 PM on 2026-10-07 = 23:00Z
const PRAYERS: PriorityItem[] = [
  { id: "prayer-asr", domain: "deen", title: "Asr", sunnahCompletions: [], dueAt: new Date("2026-10-07T20:00:00Z"), windowEndAt: new Date("2026-10-07T23:42:00Z"), date: "2026-10-07", urgencyBucket: "right_now", completed: false, actionType: "toggle_prayer", actionRefId: "asr", cost: null },
  { id: "prayer-maghrib", domain: "deen", title: "Maghrib", sunnahCompletions: [], dueAt: new Date("2026-10-07T23:42:00Z"), windowEndAt: new Date("2026-10-08T01:00:00Z"), date: "2026-10-07", urgencyBucket: "right_now", completed: false, actionType: "toggle_prayer", actionRefId: "maghrib", cost: null },
];
const PORTION: HomeNowItem = { title: "Quran · pages 41–50", from: 41, to: 50, pages: 10, surahLabel: "Al-Baqarah", juz: 2, done: false };
const at = (iso: string) => iso;

// The strip re-ticks `now` to the real clock on mount (a Router-Cache-served payload can be an hour stale), so each test pins the
// system clock to the instant it means: setup(iso) does that and returns a user-event bound to the fake timers.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());
function setup(iso: string) {
  vi.setSystemTime(new Date(iso));
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

describe("RightNowStrip", () => {
  it("shows ONLY the prayer whose window contains now, with 'until <12-hour time>' in the user's timezone, and no Quran row outside its window", () => {
    setup("2026-10-07T22:00:00Z");
    render(<RightNowStrip prayers={PRAYERS} quran={null} nowIso={at("2026-10-07T22:00:00Z")} timezone={TZ} date="2026-10-07" />);
    expect(screen.getByText("Asr")).toBeInTheDocument();
    expect(screen.queryByText("Maghrib")).not.toBeInTheDocument(); // never all at once
    expect(screen.getByText("until 6:42 PM")).toBeInTheDocument(); // 23:42Z = 6:42 PM CDT, never "18:42"
    expect(screen.queryByTestId("quran-now-row")).not.toBeInTheDocument();
  });

  it("renders NOTHING (no empty frame) between windows with no Quran row", () => {
    setup("2026-10-07T21:00:00Z");
    const { container } = render(<RightNowStrip prayers={[PRAYERS[1]!]} quran={null} nowIso={at("2026-10-07T21:00:00Z")} timezone={TZ} date="2026-10-07" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'Prayed' calls toggleItem with that prayer and the row leaves; the Quran row is not involved", async () => {
    const user = setup("2026-10-07T22:00:00Z");
    render(<RightNowStrip prayers={PRAYERS} quran={null} nowIso={at("2026-10-07T22:00:00Z")} timezone={TZ} date="2026-10-07" />);
    await user.click(screen.getByTestId("right-now-prayed"));
    expect(toggle).toHaveBeenCalledWith(PRAYERS[0]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    expect(screen.queryByText("Asr")).not.toBeInTheDocument();
  });

  it("a prayer that is missing from the pending list (already prayed) is never shown", () => {
    setup("2026-10-07T22:00:00Z");
    const { container } = render(<RightNowStrip prayers={[]} quran={null} nowIso={at("2026-10-07T22:00:00Z")} timezone={TZ} date="2026-10-07" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a sunnah chevron with its badge and expands the panel without praying", async () => {
    const user = setup("2026-10-07T22:00:00Z");
    render(<RightNowStrip prayers={PRAYERS} quran={null} nowIso={at("2026-10-07T22:00:00Z")} timezone={TZ} date="2026-10-07" />);
    await user.click(screen.getByRole("button", { name: "Sunnah for Asr" }));
    expect(toggle).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sunnah for Asr" })).toHaveAttribute("aria-expanded", "true");
  });

  describe("the Quran row (reminder window 10 PM -> 1 AM)", () => {
    // 10:30 PM CDT = 03:30Z next day; 00:30 CDT = 05:30Z; 11:00 AM CDT = 16:00Z
    const quran = (forDate: "today" | "yesterday") => ({ item: PORTION, forDate, start: null, end: null });

    it("inside the window: shown, alongside the prayer (prayer first)", () => {
      const isha = { ...PRAYERS[0]!, id: "prayer-isha", title: "Isha", actionRefId: "isha", dueAt: new Date("2026-10-08T01:30:00Z"), windowEndAt: new Date("2026-10-08T09:00:00Z") };
      setup("2026-10-08T03:30:00Z");
      render(<RightNowStrip prayers={[isha]} quran={quran("today")} nowIso={at("2026-10-08T03:30:00Z")} timezone={TZ} date="2026-10-07" />);
      const strip = screen.getByTestId("right-now-strip");
      expect(strip.textContent!.indexOf("Isha")).toBeLessThan(strip.textContent!.indexOf("Quran ·"));
      expect(screen.getByTestId("quran-now-row")).toBeInTheDocument();
    });

    it("outside the window (re-evaluated from the clock): not on Home at all", () => {
      setup("2026-10-08T16:00:00Z");
      const { container } = render(<RightNowStrip prayers={[]} quran={quran("today")} nowIso={at("2026-10-08T16:00:00Z")} timezone={TZ} date="2026-10-08" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("an already-read portion is not shown", () => {
      setup("2026-10-08T03:30:00Z");
      const { container } = render(<RightNowStrip prayers={[]} quran={{ ...quran("today"), item: { ...PORTION, done: true } }} nowIso={at("2026-10-08T03:30:00Z")} timezone={TZ} date="2026-10-07" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("post-midnight (00:30 local): shows last night's portion and logs it as yesterday's exact range", async () => {
      const user = setup("2026-10-08T05:30:00Z");
      render(<RightNowStrip prayers={[]} quran={quran("yesterday")} nowIso={at("2026-10-08T05:30:00Z")} timezone={TZ} date="2026-10-08" />);
      expect(screen.getByText(/Last night's portion/)).toBeInTheDocument();
      await user.click(screen.getByTestId("quran-now-read"));
      expect(logQuranReading).toHaveBeenCalledWith({ toPage: 50 }, { forDate: "yesterday" });
    });

    it("a row the server resolved for 'today' is hidden once the clock has crossed midnight (it would show the wrong day's portion)", () => {
      setup("2026-10-08T05:30:00Z");
      const { container } = render(<RightNowStrip prayers={[]} quran={quran("today")} nowIso={at("2026-10-08T05:30:00Z")} timezone={TZ} date="2026-10-08" />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
