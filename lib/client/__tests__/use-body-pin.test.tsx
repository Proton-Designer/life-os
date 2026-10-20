import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBodyPinForTests, useBodyPin } from "../use-body-pin";

describe("useBodyPin", () => {
  beforeEach(() => {
    resetBodyPinForTests();
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("style");
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => resetBodyPinForTests());

  it("pins the body at the current scroll offset and restores it on unmount", () => {
    document.body.style.position = "relative";
    const { unmount } = renderHook(() => useBodyPin(true));
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-120px");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    unmount();
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.top).toBe("");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
  });

  it("does nothing while inactive", () => {
    renderHook(() => useBodyPin(false));
    expect(document.body.style.position).toBe("");
  });

  it("keeps the pin until the LAST of two overlapping users releases, then restores the original state", () => {
    const a = renderHook(() => useBodyPin(true));
    const b = renderHook(() => useBodyPin(true));
    a.unmount();
    expect(document.body.style.position).toBe("fixed");
    b.unmount();
    expect(document.body.style.position).toBe("");
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
});
