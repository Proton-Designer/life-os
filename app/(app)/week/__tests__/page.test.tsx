import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: async () => ({ id: "u1" }) }));
vi.mock("@/components/shell/page-container", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/shell/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => <div data-testid={id} /> }));
vi.mock("@/components/weekly-review/weekly-review-body", () => ({ WeeklyReviewBody: stub("s-review") }));
vi.mock("@/components/goals/goals-section", () => ({ GoalsSection: stub("s-goals") }));
vi.mock("@/components/habits/habits-section", () => ({ HabitsSection: stub("s-habits") }));
vi.mock("@/components/worries/worries-section", () => ({ WorriesSection: stub("s-worries") }));
vi.mock("@/components/week/weekly-goal-step", () => ({ WeeklyGoalStep: stub("s-goal") }));

import WeekPage from "../page";

describe("/week", () => {
  it("renders the five steps in the planned order, each in its own anchored section", async () => {
    render(await WeekPage());
    const order = ["lookback", "goals", "habits", "worries", "weekly-goal"];
    const sections = order.map((id) => document.getElementById(id));
    expect(sections.every(Boolean)).toBe(true);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i - 1]!.compareDocumentPosition(sections[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const id of ["s-review", "s-goals", "s-habits", "s-worries", "s-goal"]) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^3 · Habits/ })).toHaveAttribute("href", "#habits");
  });
});
