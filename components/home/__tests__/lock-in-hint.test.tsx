import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: { id: string } | null = null;
vi.mock("@/components/business/lock-in-overlay-context", () => ({ useLockInOverlay: () => ({ session }) }));

import { LockInHint } from "../lock-in-hint";
import { visibleTimeKey } from "@/lib/client/visible-time";

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
});
