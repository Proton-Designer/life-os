import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: { id: string } | null = null;
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session }) }));

import { LockInHint } from "../lock-in-hint";
import { HINT_VISIBLE_LIMIT_MS, visibleTimeKey } from "@/lib/client/visible-time";

let visibility: "visible" | "hidden" = "visible";
let focused = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  session = null;
  visibility = "visible";
  focused = true;
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const run = (seconds: number) => act(() => void vi.advanceTimersByTime(seconds * 1000));
const hint = () => screen.queryByTestId("lock-in-hint");

describe("LockInHint (HOME-01b)", () => {
  it("shows a small hint while hours are 0 and no Lock-In runs", () => {
    render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    expect(hint()).toHaveTextContent("Start a Lock-In to log focus time");
  });

  it("is hidden once any focus time is logged (positive control: the same render with 0 shows it)", () => {
    const { rerender } = render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    expect(hint()).not.toBeNull();
    rerender(<LockInHint localDate="2026-10-05" hoursTodayMinutes={5} />);
    expect(hint()).toBeNull();
  });

  it("disappears the moment a session starts", () => {
    const { rerender } = render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    expect(hint()).not.toBeNull();
    session = { id: "s1" };
    rerender(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    expect(hint()).toBeNull();
  });

  it("retires after 3 minutes of VISIBLE time, and persists that for the rest of the day", () => {
    const { unmount } = render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    run(170);
    expect(hint()).not.toBeNull();
    run(11);
    expect(hint()).toBeNull();
    expect(Number(localStorage.getItem(visibleTimeKey("2026-10-05")))).toBeGreaterThanOrEqual(180_000);
    unmount();
    render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />); // reload later the same day
    run(1);
    expect(hint()).toBeNull();
  });

  it("only counts time the page is visible AND focused (hidden / blurred time does not retire it)", () => {
    render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    run(100);
    visibility = "hidden";
    run(600);
    expect(hint()).not.toBeNull();
    visibility = "visible";
    focused = false;
    run(600);
    expect(hint()).not.toBeNull();
    focused = true;
    run(70);
    expect(hint()).not.toBeNull(); // 100 + 70 = 170 s
    run(15);
    expect(hint()).toBeNull();
  });

  it("a new local day starts the count again", () => {
    localStorage.setItem(visibleTimeKey("2026-10-05"), String(400_000));
    render(<LockInHint localDate="2026-10-06" hoursTodayMinutes={0} />);
    expect(hint()).not.toBeNull();
  });

  it("blocked storage degrades quietly (still shows, no throw)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />)).not.toThrow();
    run(5);
    expect(hint()).not.toBeNull();
  });

  // eng1 review L2 (battery): the 1 s interval must not keep running once there is nothing left to count.
  describe("the interval stops when it has nothing to do", () => {
    it("does not start when already retired, and stops writing once the limit is reached", () => {
      const set = vi.spyOn(Storage.prototype, "setItem");
      localStorage.setItem(visibleTimeKey("2026-10-05"), String(HINT_VISIBLE_LIMIT_MS + 1000));
      set.mockClear();
      render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
      run(30);
      expect(set).not.toHaveBeenCalled(); // already retired: no ticking, no writes
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops itself the moment the limit is reached (positive control: it was ticking before)", () => {
      render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
      run(5);
      const ticking = vi.getTimerCount();
      expect(ticking).toBeGreaterThan(0); // counting
      run(180);
      expect(hint()).toBeNull();
      expect(vi.getTimerCount()).toBe(0); // retired -> interval cleared
    });

    it("does not tick when hours are already logged today", () => {
      render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={20} />);
      run(10);
      expect(vi.getTimerCount()).toBe(0);
      expect(localStorage.getItem(visibleTimeKey("2026-10-05"))).toBeNull();
    });
  });

  // eng1 review L1: two tabs on the same day must not overwrite each other downward.
  it("merges with the stored total before writing (a second tab that is ahead is never overwritten downward)", () => {
    render(<LockInHint localDate="2026-10-05" hoursTodayMinutes={0} />);
    run(10); // this tab: ~10 s
    localStorage.setItem(visibleTimeKey("2026-10-05"), String(150_000)); // the other tab reached 150 s
    run(2);
    const stored = Number(localStorage.getItem(visibleTimeKey("2026-10-05")));
    expect(stored).toBeGreaterThanOrEqual(150_000); // NOT dragged back to ~12 s
    expect(stored).toBeLessThan(160_000);
    run(40); // 150 + ~2 + 40 passes the limit -> hint retires
    expect(hint()).toBeNull();
  });
});
