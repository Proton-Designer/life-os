import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDeferredRefreshForTests, scheduleRouteRefresh } from "../deferred-refresh";

describe("scheduleRouteRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeferredRefreshForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("runs EVERY distinct surface's refresh scheduled in one window (a single 'latest' slot dropped the earlier ones)", () => {
    const home = vi.fn();
    const business = vi.fn();
    scheduleRouteRefresh(home);
    scheduleRouteRefresh(business);
    vi.advanceTimersByTime(400);
    expect(home).toHaveBeenCalledTimes(1);
    expect(business).toHaveBeenCalledTimes(1);
  });

  it("collapses repeated schedules of the SAME refresh into one call, trailing-edge", () => {
    const home = vi.fn();
    scheduleRouteRefresh(home);
    vi.advanceTimersByTime(300);
    scheduleRouteRefresh(home);
    vi.advanceTimersByTime(300);
    expect(home).not.toHaveBeenCalled(); // window restarted by the second schedule
    vi.advanceTimersByTime(100);
    expect(home).toHaveBeenCalledTimes(1);
  });

  it("closures re-created per call collapse when they share a key", () => {
    const run = vi.fn();
    for (let i = 0; i < 3; i++) scheduleRouteRefresh(() => run(), 400, "business");
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
