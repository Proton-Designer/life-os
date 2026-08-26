import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SunnahDisclosure } from "../sunnah-disclosure";

const toggleSunnahMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  toggleSunnah: (...args: unknown[]) => toggleSunnahMock(...args),
}));

// 1.5s auto-collapse timer (Ayman, 2026-08-25/26): "after the user presses
// any of the sunnah prayers ... after exactly 1.5 seconds." The timer arms
// on the TAP itself (Lead correction, 2026-08-26 — not on the write
// settling, which would make the delay unboundedly longer than 1.5s on a
// slow connection); it only consults the write's own promise at fire time,
// so it still never collapses over a write that hasn't landed yet.
//
// Uses fireEvent (not userEvent) — userEvent's own internal timer-advance
// loop deadlocks when combined with fake timers plus a real async
// transition in here; fireEvent + explicit act()-wrapped
// advanceTimersByTimeAsync calls give the same synchronous-click,
// fake-timer-driven behavior without that interaction.
describe("SunnahDisclosure — 1.5s auto-collapse timer", () => {
  beforeEach(() => {
    toggleSunnahMock.mockReset();
    toggleSunnahMock.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("with a fast write (well under 1.5s), stays open at 1499ms and collapses at exactly 1500ms from the tap", async () => {
    const onCollapse = vi.fn();
    render(<SunnahDisclosure date="2026-08-25" prayerName="fajr" sunnahCompletions={[]} onCollapse={onCollapse} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*2 rak/i }));
    });

    await act(() => vi.advanceTimersByTimeAsync(1499));
    expect(onCollapse).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("with a write still in flight at 1500ms, waits for it to land instead of collapsing on schedule", async () => {
    let resolveToggle!: () => void;
    toggleSunnahMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve;
        })
    );
    const onCollapse = vi.fn();
    render(<SunnahDisclosure date="2026-08-25" prayerName="fajr" sunnahCompletions={[]} onCollapse={onCollapse} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*2 rak/i }));
    });

    // The write takes 3s — well past the 1.5s timer's own fire time.
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(onCollapse).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(onCollapse).not.toHaveBeenCalled();

    await act(async () => {
      resolveToggle();
    });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("re-arms from the second tap — a tap at 1000ms resets the clock, so 1500ms later (not 500ms) is when it fires", async () => {
    const onCollapse = vi.fn();
    render(<SunnahDisclosure date="2026-08-25" prayerName="dhuhr" sunnahCompletions={[]} onCollapse={onCollapse} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*4 rak/i }));
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onCollapse).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /after.*2 rak/i }));
    });
    // The original timer would have fired at 1500ms total (500ms from here) — it must NOT.
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onCollapse).not.toHaveBeenCalled();

    // The re-armed timer fires 1500ms from the SECOND tap.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapses immediately on 'None', not after 1.5s, and does not fire a stale timer later", async () => {
    const onCollapse = vi.fn();
    render(<SunnahDisclosure date="2026-08-25" prayerName="fajr" sunnahCompletions={[]} onCollapse={onCollapse} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "None" }));
    });
    expect(onCollapse).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("a stale, superseded timer from an earlier tap never double-fires once the newer one collapses it", async () => {
    // First tap's write is slow (still in flight past 1.5s); before it
    // lands, a second tap re-arms. The FIRST timer's token must not still
    // fire onCollapse once its own slow write eventually resolves.
    let resolveFirst!: () => void;
    toggleSunnahMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        })
    );
    toggleSunnahMock.mockResolvedValueOnce(undefined);

    const onCollapse = vi.fn();
    render(<SunnahDisclosure date="2026-08-25" prayerName="dhuhr" sunnahCompletions={[]} onCollapse={onCollapse} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*4 rak/i }));
    });
    await act(() => vi.advanceTimersByTimeAsync(1600)); // first timer fired, but is waiting on the slow write
    expect(onCollapse).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /after.*2 rak/i }));
    });
    await act(() => vi.advanceTimersByTimeAsync(1500)); // second timer fires and its (fast) write has settled
    expect(onCollapse).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(); // the stale first write finally lands
    });
    expect(onCollapse).toHaveBeenCalledTimes(1); // still just once
  });
});
