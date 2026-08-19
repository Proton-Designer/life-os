import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QadaBacklogPanel } from "../qada-backlog-panel";
import type { QadaBacklogBuckets, QadaBacklogItem } from "@/lib/deen/qada-backlog";

const markPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
}));

function item(date: string, prayer: QadaBacklogItem["prayer"]): QadaBacklogItem {
  return { date, prayer };
}

function buckets(overrides: Partial<QadaBacklogBuckets> = {}): QadaBacklogBuckets {
  return { last7: [], month: [], older: [], ...overrides };
}

describe("QadaBacklogPanel", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
  });

  it("shows only the title and three preview counts, with no itemized list, before the dialog opens", () => {
    render(
      <QadaBacklogPanel
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
        last7Count={1}
        monthCount={3}
        allTimeCount={5}
        legacyOwed={2}
      />
    );

    expect(screen.getByText("Qada backlog")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("This month")).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Fajr")).not.toBeInTheDocument();
  });

  it("opens a sub-window listing the itemized backlog when 'View backlog' is pressed", async () => {
    render(
      <QadaBacklogPanel
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
        last7Count={1}
        monthCount={1}
        allTimeCount={1}
        legacyOwed={0}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Fajr", { exact: false })).toBeInTheDocument();
  });

  it("auto-expands the 'Last 7 days' section and shows its items immediately", async () => {
    render(
      <QadaBacklogPanel
        buckets={buckets({ last7: [item("2026-08-18", "isha")] })}
        last7Count={1}
        monthCount={1}
        allTimeCount={1}
        legacyOwed={0}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));

    const dialog = await screen.findByRole("dialog");
    const last7Header = within(dialog).getByRole("button", { name: /last 7 days/i });
    expect(last7Header).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("Isha", { exact: false })).toBeInTheDocument();
  });

  it("keeps 'This month' and 'All time' collapsed by default, showing their preview counts only", async () => {
    render(
      <QadaBacklogPanel
        buckets={buckets({ month: [item("2026-08-05", "asr")], older: [item("2026-07-01", "maghrib")] })}
        last7Count={0}
        monthCount={1}
        allTimeCount={2}
        legacyOwed={0}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /this month/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByRole("button", { name: /all time/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByText("Asr", { exact: false })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Maghrib", { exact: false })).not.toBeInTheDocument();
  });

  it("expands 'This month' on click to reveal its items, latest to oldest", async () => {
    render(
      <QadaBacklogPanel
        buckets={buckets({
          month: [item("2026-08-05", "asr"), item("2026-07-30", "fajr")],
        })}
        last7Count={0}
        monthCount={2}
        allTimeCount={2}
        legacyOwed={0}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /this month/i }));

    const rows = within(dialog).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Asr");
    expect(rows[1]).toHaveTextContent("Fajr");
  });

  it("marks an item as qada and removes it from its section optimistically", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(
      <QadaBacklogPanel
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
        last7Count={1}
        monthCount={1}
        allTimeCount={1}
        legacyOwed={0}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /mark as qada/i }));

    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-18", "fajr", "qada");
    expect(within(dialog).queryByText("Fajr", { exact: false })).not.toBeInTheDocument();
  });

  it("shows an all-caught-up empty state when there's nothing outstanding anywhere", async () => {
    render(
      <QadaBacklogPanel buckets={buckets()} last7Count={0} monthCount={0} allTimeCount={0} legacyOwed={0} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/caught up/i)).toBeInTheDocument();
  });
});
