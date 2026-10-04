import { describe, expect, it, vi } from "vitest";
import { createFocusRefresher } from "../focus-refresh";

function setup() {
  let t = 1_000_000;
  const refresh = vi.fn();
  const r = createFocusRefresher({ refresh, now: () => t });
  return { r, refresh, advance: (ms: number) => (t += ms) };
}

describe("createFocusRefresher", () => {
  it("refreshes once when the user returns after >= 60 s", () => {
    const { r, refresh, advance } = setup();
    r.left();
    advance(61_000);
    r.returned();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for a short absence", () => {
    const { r, refresh, advance } = setup();
    r.left();
    advance(59_000);
    r.returned();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh on return without ever leaving", () => {
    const { r, refresh } = setup();
    r.returned();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("visibility + focus firing together refresh only once", () => {
    const { r, refresh, advance } = setup();
    r.left(); // hidden
    r.left(); // blur
    advance(120_000);
    r.returned(); // visible
    r.returned(); // focus
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("measures from the earliest departure of a hide+blur pair", () => {
    const { r, refresh, advance } = setup();
    r.left();
    advance(50_000);
    r.left(); // later duplicate must not reset the clock
    advance(15_000);
    r.returned();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("throttles: a second return within 30 s of a refresh is skipped", () => {
    const { r, refresh, advance } = setup();
    r.left();
    advance(61_000);
    r.returned();
    r.left();
    advance(61_000); // away long enough, but only 61 s after the refresh => allowed
    r.returned();
    expect(refresh).toHaveBeenCalledTimes(2);
    const t = setup();
    t.r.left();
    t.advance(61_000);
    t.r.returned();
    t.r.left();
    t.advance(10_000);
    t.r.returned(); // short away, never refreshes
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it("minGap blocks a refresh even after a long away when one just ran", () => {
    let t = 0;
    const refresh = vi.fn();
    const r = createFocusRefresher({ refresh, now: () => t, awayMs: 1_000, minGapMs: 30_000 });
    r.left(); t += 2_000; r.returned();
    r.left(); t += 2_000; r.returned(); // away 2 s >= awayMs, but 2 s since last refresh < 30 s
    expect(refresh).toHaveBeenCalledTimes(1);
    r.left(); t += 31_000; r.returned();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
