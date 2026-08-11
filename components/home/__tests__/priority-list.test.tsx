import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriorityList } from "../priority-list";
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
});
