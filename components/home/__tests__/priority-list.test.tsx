import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriorityList } from "../priority-list";
import { RIGHT_NOW_WINDOW_MS } from "@/lib/home/urgency";
import type { PriorityItem } from "@/lib/home/types";

const toggleItemMock = vi.fn();
vi.mock("@/app/(app)/actions", () => ({
  toggleItem: (item: PriorityItem) => toggleItemMock(item),
}));

function makeItem(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return {
    id: "1",
    domain: "deen",
    title: "Fajr",
    dueAt: null,
    date: "2026-08-11",
    urgencyBucket: "right_now",
    completed: false,
    actionType: "toggle_prayer",
    actionRefId: "fajr",
    ...overrides,
  };
}

describe("PriorityList", () => {
  beforeEach(() => {
    toggleItemMock.mockReset();
  });

  it("removes a row immediately on click, before the server action resolves (optimistic update)", async () => {
    let resolveToggle: () => void = () => {};
    toggleItemMock.mockImplementation(
      () => new Promise<void>((resolve) => { resolveToggle = resolve; })
    );

    render(<PriorityList items={[makeItem()]} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: 'Mark "Fajr" done' }));

    // Optimistically gone from the list before toggleItem's promise ever resolves.
    expect(screen.queryByText("Fajr")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing due right now.")).toBeInTheDocument();

    resolveToggle();
  });

  it("removes only the clicked row, leaving other items visible", async () => {
    toggleItemMock.mockImplementation(() => new Promise<void>(() => {}));

    render(
      <PriorityList
        items={[makeItem({ id: "1", title: "Fajr" }), makeItem({ id: "2", title: "Dhuhr", actionRefId: "dhuhr" })]}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: 'Mark "Fajr" done' }));

    expect(screen.queryByText("Fajr")).not.toBeInTheDocument();
    expect(screen.getByText("Dhuhr")).toBeInTheDocument();
  });

  describe("client-side urgency re-derivation", () => {
    const NOW = new Date("2026-08-13T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("flips an item from Later today into Right now as the clock crosses the 2h boundary, with no refetch", async () => {
      // Server computed this as later_today at render time (due just outside
      // the 2h window) — matches what the real server-side urgencyBucket()
      // would have produced for the same dueAt/now.
      const dueAt = new Date(NOW.getTime() + RIGHT_NOW_WINDOW_MS + 5 * 60 * 1000);
      const item = makeItem({ dueAt, urgencyBucket: "later_today" });

      render(<PriorityList items={[item]} />);
      // Mount effect fires synchronously against the fake "now" — matches
      // the server bucket, no flip yet.
      expect(screen.getByText("Fajr").closest("section")).toHaveTextContent("Later today");
      expect(screen.queryByRole("heading", { name: "Right now" })).not.toBeInTheDocument();

      // Advance the clock past the boundary — the interval tick re-derives
      // the bucket client-side, no server round trip involved.
      await act(async () => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });

      expect(screen.getByText("Fajr").closest("section")).toHaveTextContent("Right now");
      expect(screen.queryByRole("heading", { name: "Later today" })).not.toBeInTheDocument();
      expect(toggleItemMock).not.toHaveBeenCalled();
    });
  });
});
