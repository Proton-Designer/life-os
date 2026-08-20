import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QadaBacklogCard } from "../qada-backlog-card";
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

describe("QadaBacklogCard", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
  });

  it("shows the title, the last-7-days count as the headline, and the caption, with no itemized list before the dialog opens", () => {
    render(
      <QadaBacklogCard
        accent="business"
        caption="1 caught up in the last 7 days"
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
        legacyOwed={2}
      />
    );

    expect(screen.getByText("Qada backlog")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1 caught up in the last 7 days")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Fajr")).not.toBeInTheDocument();
  });

  it("opens a sub-window listing the itemized backlog when 'View backlog' is pressed", async () => {
    render(
      <QadaBacklogCard
        accent="business"
        caption="1 caught up in the last 7 days"
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
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
      <QadaBacklogCard
        accent="warning"
        caption="1 added in the last 7 days"
        buckets={buckets({ last7: [item("2026-08-18", "isha")] })}
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

  it("keeps 'Earlier this month' and 'All time' collapsed by default, showing their preview counts only", async () => {
    render(
      <QadaBacklogCard
        accent="warning"
        caption="1 added in the last 7 days"
        buckets={buckets({ month: [item("2026-08-05", "asr")], older: [item("2026-07-01", "maghrib")] })}
        legacyOwed={0}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /earlier this month/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByRole("button", { name: /all time/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByText("Asr", { exact: false })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Maghrib", { exact: false })).not.toBeInTheDocument();
  });

  it("marks an item as qada and removes it from its section optimistically", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(
      <QadaBacklogCard
        accent="business"
        caption="1 caught up in the last 7 days"
        buckets={buckets({ last7: [item("2026-08-18", "fajr")] })}
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
      <QadaBacklogCard accent="business" caption="None caught up in the last 7 days" buckets={buckets()} legacyOwed={0} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View backlog" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/caught up/i)).toBeInTheDocument();
  });
});
