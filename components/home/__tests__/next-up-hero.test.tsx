import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const { toggleItemMock } = vi.hoisted(() => ({ toggleItemMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  toggleItem: toggleItemMock,
  refreshHome: vi.fn(async () => {}),
}));
import { NextUpHero } from "../next-up-hero";
import type { PriorityItem } from "@/lib/home/types";

const NOW = new Date("2026-08-15T12:00:00Z");

function item(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return {
    id: "1",
    domain: "business",
    title: "Ship the thing",
    dueAt: null,
    date: "2026-08-15",
    urgencyBucket: "right_now",
    actionType: "toggle_task",
    ...overrides,
  } as PriorityItem;
}

describe("NextUpHero", () => {
  it("uses the item's own domain accent, not a hardcoded one", () => {
    render(<NextUpHero item={item({ domain: "business" })} now={NOW} caption="2 more today" data-testid="hero" />);
    const hero = screen.getByTestId("hero");
    expect(hero.style.backgroundImage).toContain("--accent-business");
    expect(hero.style.backgroundImage).not.toContain("--accent-deen");
  });

  it("switches accent when the item's domain changes", () => {
    render(<NextUpHero item={item({ domain: "fitness" })} now={NOW} caption="2 more today" data-testid="hero" />);
    expect(screen.getByTestId("hero").style.backgroundImage).toContain("--accent-fitness");
  });

  it("renders an IconChip for the item's domain", () => {
    render(<NextUpHero item={item({ domain: "school" })} now={NOW} caption="2 more today" data-testid="hero" />);
    expect(screen.getByTestId("hero").querySelector("svg")).toBeInTheDocument();
  });

  it("uses its own coop accent, no longer folded onto school", () => {
    render(<NextUpHero item={item({ domain: "co_op" })} now={NOW} caption="2 more today" data-testid="hero" />);
    expect(screen.getByTestId("hero").style.backgroundImage).toContain("--accent-coop");
  });

  it("formats an overdue item in hours, not raw minutes (778 min -> 13h overdue)", () => {
    const dueAt = new Date(NOW.getTime() - 778 * 60_000);
    render(<NextUpHero item={item({ dueAt })} now={NOW} caption="2 more today" />);
    expect(screen.getByText(/13h overdue/)).toBeInTheDocument();
  });

  it("formats an upcoming item in hours once past the 1-hour mark", () => {
    const dueAt = new Date(NOW.getTime() + 150 * 60_000);
    render(<NextUpHero item={item({ dueAt })} now={NOW} caption="2 more today" />);
    expect(screen.getByText(/in 3h/)).toBeInTheDocument();
  });

  // Regression: an open prayer window (dueAt = window start, already
  // passed) used to read "Xh overdue," backwards — the prayer isn't late,
  // it has time left before the window closes.
  it("shows time left, not overdue, for an item whose window has opened but not closed", () => {
    const dueAt = new Date(NOW.getTime() - 120 * 60_000); // window opened 2h ago
    const windowEndAt = new Date(NOW.getTime() + 120 * 60_000); // closes in 2h
    render(<NextUpHero item={item({ dueAt, windowEndAt })} now={NOW} caption="2 more today" />);
    expect(screen.getByText(/2h left/)).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("has an opaque --card base, not just a transparent-past-70% radial wash", () => {
    render(<NextUpHero item={item()} now={NOW} caption="2 more today" data-testid="hero" />);
    expect(screen.getByTestId("hero").style.backgroundColor).toBe("var(--card)");
  });

  it("renders the mandatory caption", () => {
    render(<NextUpHero item={item()} now={NOW} caption="3 more today" />);
    expect(screen.getByText("3 more today")).toBeInTheDocument();
  });

  it("carries the Tier-1 fixed min-height so it aligns with the other 3 KPI cards", () => {
    render(<NextUpHero item={item()} now={NOW} caption="2 more today" data-testid="hero" />);
    expect(screen.getByTestId("hero").className).toContain("min-h-[168px]");
  });

  // PERF-2: Mark done is instant from local state, never waits for the Home re-render,
  // can't double-submit, and reverts with an inline error if the write fails.
  describe("Mark done", () => {
    beforeEach(() => {
      resetKeyedQueuesForTests();
      toggleItemMock.mockReset();
    });

    it("flips to Done immediately and writes once even on a double tap", async () => {
      toggleItemMock.mockImplementation(() => new Promise<void>(() => {}));
      render(<NextUpHero item={item()} now={NOW} caption="x" />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Mark done" }));
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(toggleItemMock).toHaveBeenCalledTimes(1);
    });

    it("reverts and shows an error when the write fails", async () => {
      toggleItemMock.mockRejectedValue(new Error("nope"));
      render(<NextUpHero item={item()} now={NOW} caption="x" />);
      await userEvent.setup().click(screen.getByRole("button", { name: "Mark done" }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
    });
  });
});
