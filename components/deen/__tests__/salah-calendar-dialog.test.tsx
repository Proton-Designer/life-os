import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SalahCalendarDialog } from "../salah-calendar-dialog";
import type { SalahDaySummary, SalahDayDetail } from "@/app/(app)/deen/salah-calendar-actions";

const { getSalahMonthSummaryMock, getSalahDayDetailMock, markPrayerMock } = vi.hoisted(() => ({
  getSalahMonthSummaryMock: vi.fn(),
  getSalahDayDetailMock: vi.fn(),
  markPrayerMock: vi.fn(async () => {}),
}));

vi.mock("@/app/(app)/deen/salah-calendar-actions", () => ({
  getSalahMonthSummary: getSalahMonthSummaryMock,
  getSalahDayDetail: getSalahDayDetailMock,
}));
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: markPrayerMock,
}));

const TODAY = "2026-08-26";

// August 2026: 31 days, all real dates for the tests below.
function augustSummary(overrides: Partial<Record<string, Partial<SalahDaySummary>>> = {}): SalahDaySummary[] {
  return Array.from({ length: 31 }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    const date = `2026-08-${day}`;
    const base: SalahDaySummary = { date, doneCount: 0, hasData: false };
    return { ...base, ...(overrides[date] ?? {}) };
  });
}

function renderDialog(days: SalahDaySummary[]) {
  getSalahMonthSummaryMock.mockResolvedValue(days);
  return render(
    <SalahCalendarDialog open onOpenChange={vi.fn()} initialYear={2026} initialMonth={8} todayStr={TODAY} />
  );
}

describe("SalahCalendarDialog", () => {
  beforeEach(() => {
    getSalahMonthSummaryMock.mockReset();
    getSalahDayDetailMock.mockReset();
    markPrayerMock.mockClear();
  });

  it("renders a future day with no ring at all — never a 0/5 ring", async () => {
    renderDialog(augustSummary({ "2026-08-30": { hasData: false } }));
    await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());
    expect(screen.queryByText("0/5")).not.toBeInTheDocument();
  });

  it("renders a genuinely tracked, zero-completed past day as a real 0/5 ring, distinct from an untracked day", async () => {
    renderDialog(augustSummary({ "2026-08-10": { hasData: true, doneCount: 0 } }));
    await waitFor(() => expect(screen.getByText("0/5")).toBeInTheDocument());
  });

  it("renders a tracked day's real completion count", async () => {
    renderDialog(augustSummary({ "2026-08-15": { hasData: true, doneCount: 3 } }));
    await waitFor(() => expect(screen.getByText("3/5")).toBeInTheDocument());
  });

  it("disables clicking a future day cell", async () => {
    const user = userEvent.setup();
    renderDialog(augustSummary({ "2026-08-30": { hasData: false } }));
    await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());
    const futureCell = screen.getByText("30").closest("button")!;
    expect(futureCell).toBeDisabled();
    await user.click(futureCell);
    expect(getSalahDayDetailMock).not.toHaveBeenCalled();
  });

  it("opens the day editor for a past/today day and lets the user change a prayer's status", async () => {
    const user = userEvent.setup();
    const detail: SalahDayDetail[] = [
      { prayerName: "fajr", label: "Fajr", status: "missed" },
      { prayerName: "dhuhr", label: "Dhuhr", status: "on_time" },
      { prayerName: "asr", label: "Asr", status: "on_time" },
      { prayerName: "maghrib", label: "Maghrib", status: "on_time" },
      { prayerName: "isha", label: "Isha", status: "on_time" },
    ];
    getSalahDayDetailMock.mockResolvedValue(detail);
    renderDialog(augustSummary({ "2026-08-10": { hasData: true, doneCount: 4 } }));
    await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());

    await user.click(screen.getByText("10").closest("button")!);
    expect(await screen.findByText("2026-08-10")).toBeInTheDocument();

    const fajrRow = (await screen.findByText("Fajr")).closest("li")!;
    await user.click(within(fajrRow).getByRole("button", { name: "Qada" }));
    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-10", "fajr", "qada");
  });

  it("navigates to the next month and refetches", async () => {
    const user = userEvent.setup();
    renderDialog(augustSummary());
    await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());
    getSalahMonthSummaryMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, doneCount: 0, hasData: false }))
    );
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByText("September 2026")).toBeInTheDocument();
    expect(getSalahMonthSummaryMock).toHaveBeenCalledWith(2026, 9);
  });

  it("rolls year over when going to previous month from January", async () => {
    const user = userEvent.setup();
    getSalahMonthSummaryMock.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, doneCount: 0, hasData: false }))
    );
    render(<SalahCalendarDialog open onOpenChange={vi.fn()} initialYear={2026} initialMonth={1} todayStr={TODAY} />);
    await waitFor(() => expect(screen.getByText("January 2026")).toBeInTheDocument());
    getSalahMonthSummaryMock.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ date: `2025-12-${String(i + 1).padStart(2, "0")}`, doneCount: 0, hasData: false }))
    );
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("December 2025")).toBeInTheDocument();
    expect(getSalahMonthSummaryMock).toHaveBeenCalledWith(2025, 12);
  });
});
