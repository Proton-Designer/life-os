import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
