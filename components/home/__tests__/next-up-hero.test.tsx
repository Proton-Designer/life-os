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
    render(<NextUpHero item={item({ domain: "business" })} now={NOW} data-testid="hero" />);
    const hero = screen.getByTestId("hero");
    expect(hero.style.background).toContain("--accent-business");
    expect(hero.style.background).not.toContain("--accent-deen");
  });

  it("switches accent when the item's domain changes", () => {
    render(<NextUpHero item={item({ domain: "fitness" })} now={NOW} data-testid="hero" />);
    expect(screen.getByTestId("hero").style.background).toContain("--accent-fitness");
  });

  it("renders an IconChip for the item's domain", () => {
    render(<NextUpHero item={item({ domain: "school" })} now={NOW} data-testid="hero" />);
    expect(screen.getByTestId("hero").querySelector("svg")).toBeInTheDocument();
  });

  it("uses its own coop accent, no longer folded onto school", () => {
    render(<NextUpHero item={item({ domain: "co_op" })} now={NOW} data-testid="hero" />);
    expect(screen.getByTestId("hero").style.background).toContain("--accent-coop");
  });

  it("formats an overdue item in hours, not raw minutes (778 min -> 13h overdue)", () => {
    // 778 minutes before NOW (2026-08-15T12:00:00Z).
    const dueAt = new Date(NOW.getTime() - 778 * 60_000);
    render(<NextUpHero item={item({ dueAt })} now={NOW} />);
    expect(screen.getByText(/13h overdue/)).toBeInTheDocument();
  });

  it("formats an upcoming item in hours once past the 1-hour mark", () => {
    const dueAt = new Date(NOW.getTime() + 150 * 60_000);
    render(<NextUpHero item={item({ dueAt })} now={NOW} />);
    expect(screen.getByText(/in 3h/)).toBeInTheDocument();
  });
});
