import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoRefreshWhileProcessing } from "../auto-refresh-while-processing";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("AutoRefreshWhileProcessing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the page every 5 seconds while mounted and active", () => {
    render(<AutoRefreshWhileProcessing active />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does nothing when nothing is processing (active=false)", () => {
    render(<AutoRefreshWhileProcessing active={false} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops polling the moment it unmounts (the page re-rendered without a processing book)", () => {
    const { unmount } = render(<AutoRefreshWhileProcessing active />);
    act(() => vi.advanceTimersByTime(5000));
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops while the tab is hidden and catches up with ONE immediate refresh when it is shown again", () => {
    render(<AutoRefreshWhileProcessing active />);
    act(() => setHidden(true));
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
    act(() => setHidden(false));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a tab that starts hidden does not poll", () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    render(<AutoRefreshWhileProcessing active />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("turning active off (a prop change) stops the timer", () => {
    const { rerender } = render(<AutoRefreshWhileProcessing active />);
    act(() => vi.advanceTimersByTime(5000));
    rerender(<AutoRefreshWhileProcessing active={false} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
