import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrayerRow } from "../prayer-row";
import { SalahCalendarDialog } from "../salah-calendar-dialog";
import { AdhkarStrip } from "../adhkar-strip";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import type { SalahDayDetail } from "@/app/(app)/deen/salah-calendar-actions";

// PERF-1 invariants for the Deen controls: instant per-item state, nothing else
// disabled while one write is in flight, same-item taps stored in tap order
// (final state = last tap), different items independent, errors revert ONLY the
// failing item.

const { setAdhkarMock, refreshMock, markPrayerMock, unmarkPrayerMock, getSalahMonthSummaryMock, getSalahDayDetailMock } = vi.hoisted(() => ({
  setAdhkarMock: vi.fn(),
  refreshMock: vi.fn(async () => {}),
  markPrayerMock: vi.fn(),
  unmarkPrayerMock: vi.fn(),
  getSalahMonthSummaryMock: vi.fn(),
  getSalahDayDetailMock: vi.fn(),
}));
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: markPrayerMock,
  unmarkPrayer: unmarkPrayerMock,
  setSunnah: vi.fn(),
  setAdhkar: setAdhkarMock,
  refreshDeenViews: refreshMock,
}));
vi.mock("@/app/(app)/deen/salah-calendar-actions", () => ({
  getSalahMonthSummary: getSalahMonthSummaryMock,
  getSalahDayDetail: getSalahDayDetailMock,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const isActive = (btn: HTMLElement) => !(btn.querySelector("span")?.className ?? "").includes("text-muted-foreground");

describe("Deen controls — concurrency (PerfDeen)", () => {
  beforeEach(() => {
    resetKeyedQueuesForTests();
    markPrayerMock.mockReset();
    refreshMock.mockClear();
    unmarkPrayerMock.mockReset();
    setAdhkarMock.mockReset();
    getSalahMonthSummaryMock.mockReset();
    getSalahDayDetailMock.mockReset();
  });

  it("rapid taps on the SAME prayer: writes go out in tap order, one at a time, and the final stored state is the last tap", async () => {
    const first = deferred();
    markPrayerMock.mockImplementationOnce(() => first.promise).mockImplementation(async () => {});
    const user = userEvent.setup();
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />);

    await user.click(screen.getByRole("button", { name: "On-time" }));
    await user.click(screen.getByRole("button", { name: "Qada" }));
    await user.click(screen.getByRole("button", { name: "Missed" }));

    // UI already shows the LAST tap although the first write has not finished.
    expect(isActive(screen.getByRole("button", { name: "Missed" }))).toBe(true);
    // Only the first write has been sent; the others wait their turn.
    expect(markPrayerMock).toHaveBeenCalledTimes(1);
    expect(markPrayerMock).toHaveBeenLastCalledWith("2026-08-11", "fajr", "on_time");

    await act(async () => first.resolve());
    await waitFor(() => expect(markPrayerMock).toHaveBeenCalledTimes(3));
    expect(markPrayerMock.mock.calls.map((c) => c[2])).toEqual(["on_time", "qada", "missed"]);
    expect(isActive(screen.getByRole("button", { name: "Missed" }))).toBe(true);
  });

  it("a burst of taps triggers exactly ONE deferred refreshDeenViews after the writes settle (not one per tap)", async () => {
    markPrayerMock.mockImplementation(async () => {});
    const user = userEvent.setup();
    render(
      <ul>
        <PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />
        <PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />
      </ul>
    );
    await user.click(within(screen.getByLabelText("Fajr")).getByRole("button", { name: "On-time" }));
    await user.click(within(screen.getByLabelText("Dhuhr")).getByRole("button", { name: "On-time" }));
    await user.click(within(screen.getByLabelText("Fajr")).getByRole("button", { name: "Qada" }));
    expect(refreshMock).not.toHaveBeenCalled(); // nothing re-renders inside the taps
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 600));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("no button is disabled while a write is in flight (this prayer's siblings AND other prayers)", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    const user = userEvent.setup();
    render(
      <ul>
        <PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />
        <PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />
      </ul>
    );
    await user.click(within(screen.getByLabelText("Fajr")).getByRole("button", { name: "On-time" }));
    for (const b of screen.getAllByRole("button", { name: /On-time|Qada|Missed/ })) expect(b).toBeEnabled();
  });

  it("two DIFFERENT prayers in flight: both writes are sent immediately and both persist", async () => {
    const a = deferred();
    const b = deferred();
    markPrayerMock.mockImplementation((_d: string, name: string) => (name === "fajr" ? a.promise : b.promise));
    const user = userEvent.setup();
    render(
      <ul>
        <PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />
        <PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />
      </ul>
    );
    await user.click(within(screen.getByLabelText("Fajr")).getByRole("button", { name: "On-time" }));
    await user.click(within(screen.getByLabelText("Dhuhr")).getByRole("button", { name: "Qada" }));
    expect(markPrayerMock).toHaveBeenCalledTimes(2); // neither waited for the other
    await act(async () => {
      a.resolve();
      b.resolve();
    });
    expect(markPrayerMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([["fajr", "on_time"], ["dhuhr", "qada"]]);
  });

  it("an error reverts ONLY the failing prayer and shows an inline error; the other stays as tapped", async () => {
    markPrayerMock.mockImplementation(async (_d: string, name: string) => {
      if (name === "fajr") throw new Error("network down");
    });
    const user = userEvent.setup();
    render(
      <ul>
        <PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />
        <PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />
      </ul>
    );
    const fajrRow = screen.getByText("Fajr").closest("li")!;
    const dhuhrRow = screen.getByText("Dhuhr").closest("li")!;
    await user.click(within(fajrRow).getByRole("button", { name: "On-time" }));
    await user.click(within(dhuhrRow).getByRole("button", { name: "On-time" }));

    await waitFor(() => expect(within(fajrRow).getByRole("alert")).toHaveTextContent("network down"));
    expect(isActive(within(fajrRow).getByRole("button", { name: "On-time" }))).toBe(false); // reverted
    expect(isActive(within(dhuhrRow).getByRole("button", { name: "On-time" }))).toBe(true); // untouched
    expect(within(dhuhrRow).queryByRole("alert")).toBeNull();
  });

  it("Salah View More day editor: pressing one prayer's button does not grey out or block any other button, and the pressed one flips before the server answers", async () => {
    const detail: SalahDayDetail[] = (["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((p) => ({
      prayerName: p,
      label: p[0].toUpperCase() + p.slice(1),
      status: "pending",
    }));
    getSalahMonthSummaryMock.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, doneCount: 0, hasData: true }))
    );
    getSalahDayDetailMock.mockResolvedValue(detail);
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {})); // never answers
    const user = userEvent.setup();
    render(<SalahCalendarDialog open onOpenChange={vi.fn()} initialYear={2026} initialMonth={8} todayStr="2026-08-26" />);
    await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());
    await user.click(screen.getByText("10").closest("button")!);
    const fajrRow = (await screen.findByText("Fajr")).closest("li")!;

    await user.click(within(fajrRow).getByRole("button", { name: "Qada" }));

    // pressed button flipped immediately (default variant = active) …
    expect(within(fajrRow).getByRole("button", { name: "Qada" }).className).toContain("bg-primary");
    // … and nothing in the editor is disabled, including the same row's other buttons and every other prayer.
    for (const b of screen.getAllByRole("button", { name: /^(On-time|Qada|Missed)$/ })) expect(b).toBeEnabled();
    // another prayer can be pressed right away and sends its own write without waiting
    await user.click(within((await screen.findByText("Isha")).closest("li")!).getByRole("button", { name: "Missed" }));
    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-10", "isha", "missed");
  });

  // PERF-1 review F1: relative writes break "last tap wins" after a failure. The
  // controls now send the ABSOLUTE intended value, so a queued tap behind a failed
  // one still stores exactly what the user last chose.
  it("adhkar: a failed write followed by a queued tap sends absolute values (true, then false)", async () => {
    const first = deferred();
    setAdhkarMock.mockImplementationOnce(() => first.promise).mockImplementation(async () => {});
    const user = userEvent.setup();
    render(<AdhkarStrip date="2026-08-11" morningCompleted={false} eveningCompleted={false} />);
    const morning = screen.getByRole("button", { name: /Morning adhkar/ });

    await user.click(morning); // -> true, in flight
    await user.click(morning); // -> false, queued behind it
    expect(setAdhkarMock).toHaveBeenCalledTimes(1);
    expect(setAdhkarMock).toHaveBeenNthCalledWith(1, "2026-08-11", "morning", true);

    await act(async () => {
      first.reject(new Error("boom"));
    });
    await waitFor(() => expect(setAdhkarMock).toHaveBeenCalledTimes(2));
    // The second write states the user's last choice outright instead of "flip".
    expect(setAdhkarMock).toHaveBeenNthCalledWith(2, "2026-08-11", "morning", false);
    await waitFor(() => expect(screen.getByRole("button", { name: /Morning adhkar/ })).toHaveAttribute("aria-pressed", "false"));
  });
});
