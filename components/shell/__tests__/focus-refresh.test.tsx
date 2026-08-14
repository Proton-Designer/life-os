import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { FocusRefresh } from "../focus-refresh";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("FocusRefresh", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    setVisibility("visible");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not refresh on mount while already visible (no hidden->visible transition happened)", () => {
    render(<FocusRefresh />);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not refresh merely going visible->hidden", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes on an actual hidden->visible transition", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh again within the 10s debounce window", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refreshMock).toHaveBeenCalledTimes(1); // still debounced
  });

  it("refreshes again once the debounce window has passed", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_001);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});
