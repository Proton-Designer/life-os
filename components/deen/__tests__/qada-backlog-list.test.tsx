import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QadaBacklogList } from "../qada-backlog-list";
import type { QadaBacklogItem } from "@/lib/deen/qada-backlog";

const markPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
}));

function item(date: string, prayer: QadaBacklogItem["prayer"]): QadaBacklogItem {
  return { date, prayer };
}

describe("QadaBacklogList", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
  });

  it("shows an empty state when there's nothing outstanding", () => {
    render(<QadaBacklogList items={[]} />);
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("renders the oldest outstanding prayers first, even though items arrive most-recent-first", () => {
    const items = [item("2026-08-10", "isha"), item("2026-08-09", "asr"), item("2026-08-08", "fajr")];
    render(<QadaBacklogList items={items} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Fajr");
    expect(rows[rows.length - 1]).toHaveTextContent("Isha");
  });

  it("caps the list at the given limit, keeping the oldest", () => {
    const items = [item("2026-08-10", "isha"), item("2026-08-09", "asr"), item("2026-08-08", "fajr")];
    render(<QadaBacklogList items={items} limit={2} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Fajr");
    expect(rows[1]).toHaveTextContent("Asr");
  });

  it("marks an item as qada and removes it optimistically on click", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<QadaBacklogList items={[item("2026-08-08", "fajr")]} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /mark as qada/i }));

    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-08", "fajr", "qada");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
