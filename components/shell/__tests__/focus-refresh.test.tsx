import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { FocusRefresh } from "../focus-refresh";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("FocusRefresh", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("calls router.refresh once when the tab returns after 2 minutes", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    vi.advanceTimersByTime(120_000);
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a quick tab switch", () => {
    render(<FocusRefresh />);
    setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<FocusRefresh />);
    unmount();
    setVisibility("hidden");
    vi.advanceTimersByTime(120_000);
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();
  });
});
