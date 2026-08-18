import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PriorityItem } from "@/lib/home/types";

vi.mock("@/app/(app)/actions", () => ({
  toggleItem: vi.fn(async () => {}),
}));

import { toggleItem } from "@/app/(app)/actions";
import { NextActions } from "../next-actions";

// A fixed instant, deliberately far from real wall-clock time — any test
// asserting relative-time text this way is proof the text was seeded from
// `nowIso`, not from whatever `new Date()` happens to return when the test
// runs.
const NOW_ISO = "2026-08-17T22:00:00.000Z";
const NOW_MS = new Date(NOW_ISO).getTime();

function item(overrides: Partial<PriorityItem> & Pick<PriorityItem, "id" | "domain">): PriorityItem {
  return {
    title: overrides.id,
    dueAt: null,
    date: "2026-08-17",
    urgencyBucket: "later_today",
    completed: false,
    actionType: "toggle_task",
    actionRefId: overrides.id,
    ...overrides,
  };
}

describe("NextActions", () => {
  it("shows the all-clear empty state with a planning link when nothing is pending", () => {
    render(<NextActions items={[]} isFreshInstall={false} nowIso={NOW_ISO} />);
    expect(screen.getByText("You're all clear")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan the week" })).toHaveAttribute("href", "/weekly-planning");
  });

  it("shows the fresh-install copy instead when isFreshInstall and nothing is pending", () => {
    render(<NextActions items={[]} isFreshInstall nowIso={NOW_ISO} />);
    expect(screen.getByText("Welcome — head into a domain tab to get started")).toBeInTheDocument();
  });

  it("renders one row per domain with its title and domain label", () => {
    const items = [
      item({ id: "fajr", domain: "deen", title: "Fajr" }),
      item({ id: "kill-list", domain: "business", title: "Ship the proposal" }),
    ];
    render(<NextActions items={items} isFreshInstall={false} nowIso={NOW_ISO} />);

    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("Ship the proposal")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
  });

  it("corrects a stale nowIso (a Router-Cache-served hour-old payload) via the effect's immediate tick", () => {
    // The seed alone would show a due time computed against an hour-old
    // clock; the immediate tick inside the effect must correct it to the
    // real current time before anything is asserted here.
    const staleNowIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const items = [
      item({
        id: "fajr",
        domain: "deen",
        title: "Fajr",
        dueAt: new Date(Date.now() + 45 * 60_000),
        urgencyBucket: "later_today",
      }),
    ];
    render(<NextActions items={items} isFreshInstall={false} nowIso={staleNowIso} />);
    expect(screen.getByText("in 45m")).toBeInTheDocument();
  });

  it("badges only the single earliest right_now item as Now", () => {
    const items = [
      item({
        id: "fajr",
        domain: "deen",
        title: "Fajr",
        dueAt: new Date(NOW_MS + 10 * 60_000),
        urgencyBucket: "right_now",
      }),
      item({
        id: "workout",
        domain: "fitness",
        title: "Run",
        dueAt: new Date(NOW_MS + 60 * 60_000),
        urgencyBucket: "right_now",
      }),
      item({ id: "task-1", domain: "school", title: "Essay", urgencyBucket: "later_today" }),
    ];
    render(<NextActions items={items} isFreshInstall={false} nowIso={NOW_ISO} />);

    expect(screen.getAllByText("Now")).toHaveLength(1);
    const fajrRow = screen.getByText("Fajr").closest("li");
    expect(fajrRow).not.toBeNull();
    expect(fajrRow!.textContent).toContain("Now");
  });

  it("suppresses the redundant relative-time text when the badged item's time would also read Now", () => {
    const items = [
      item({
        id: "fajr",
        domain: "deen",
        title: "Fajr",
        dueAt: new Date(NOW_MS), // due this instant — formatRelativeDuration("Now")
        urgencyBucket: "right_now",
      }),
    ];
    render(<NextActions items={items} isFreshInstall={false} nowIso={NOW_ISO} />);

    const fajrRow = screen.getByText("Fajr").closest("li");
    expect(fajrRow).not.toBeNull();
    // The badge shows "Now" exactly once — not doubled with a second "Now" as the time text.
    expect(screen.getAllByText("Now")).toHaveLength(1);
  });

  it("marks an item done via toggleItem and removes it optimistically on click", async () => {
    // A never-resolving promise keeps the transition pending, so we observe
    // the optimistic removal itself rather than useOptimistic reverting once
    // the (unchanged) items prop settles back in after the action resolves.
    vi.mocked(toggleItem).mockImplementation(() => new Promise(() => {}));
    const items = [item({ id: "fajr", domain: "deen", title: "Fajr" })];
    const user = userEvent.setup();
    render(<NextActions items={items} isFreshInstall={false} nowIso={NOW_ISO} />);

    const button = screen.getByRole("button", { name: 'Mark "Fajr" done' });
    await user.click(button);

    expect(toggleItem).toHaveBeenCalledWith(items[0]);
    expect(screen.queryByText("Fajr")).not.toBeInTheDocument();
  });
});
