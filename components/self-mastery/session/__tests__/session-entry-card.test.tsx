import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionEntryCard } from "../session-entry-card";

const loadTodaysSessionMock = vi.fn(async () => new Promise(() => {})); // never resolves -- just proving it opens

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

function due(overrides: Partial<{ dueCount: number; newCount: number; estimatedMinutes: number; hasBooks: boolean }>) {
  return { dueCount: 0, newCount: 0, estimatedMinutes: 0, hasBooks: true, ...overrides };
}

describe("SessionEntryCard", () => {
  beforeEach(() => {
    loadTodaysSessionMock.mockClear();
    pushMock.mockClear();
  });

  it("renders nothing when dueSummary is null (unauthenticated/render-path degrade)", () => {
    const { container } = render(<SessionEntryCard dueSummary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the due count and estimated minutes", () => {
    render(<SessionEntryCard dueSummary={due({ dueCount: 12, estimatedMinutes: 7 })} />);
    expect(screen.getByText("12 cards due, ~7 min")).toBeInTheDocument();
  });

  it("singularizes 'card' for exactly one due", () => {
    render(<SessionEntryCard dueSummary={due({ dueCount: 1, estimatedMinutes: 2 })} />);
    expect(screen.getByText("1 card due, ~2 min")).toBeInTheDocument();
  });

  it("shows the caught-up copy when nothing is due and nothing is new, still tappable", () => {
    render(<SessionEntryCard dueSummary={due({})} />);
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
    expect(screen.getByText("Review anyway")).toBeInTheDocument();
  });

  it("shows 'ready to start' copy for a fresh deck with nothing due yet -- day one must not read as broken", () => {
    render(<SessionEntryCard dueSummary={due({ newCount: 12, estimatedMinutes: 8 })} />);
    expect(screen.getByText("12 cards ready to start, ~8 min")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing due/)).not.toBeInTheDocument();
  });

  it("prefers due copy over new-card copy when both are non-zero", () => {
    render(<SessionEntryCard dueSummary={due({ dueCount: 3, newCount: 5, estimatedMinutes: 6 })} />);
    expect(screen.getByText("3 cards due, ~6 min")).toBeInTheDocument();
    expect(screen.queryByText(/ready to start/)).not.toBeInTheDocument();
  });

  it("tapping the card opens the session overlay (loadTodaysSession fires, not blocked)", async () => {
    const user = userEvent.setup();
    render(<SessionEntryCard dueSummary={due({ dueCount: 3, estimatedMinutes: 5 })} />);

    await user.click(screen.getByRole("button", { name: /cards due/ }));

    expect(loadTodaysSessionMock).toHaveBeenCalled();
  });

  // The "Add a book to get started" banner was removed from Home on request (2026-10-04): an account with
  // no books sees no Self-Mastery entry card at all. (Zero books is never a failure signal either: the old
  // "Your starter deck didn't load" / "Retry" copy must stay gone.)
  describe("empty library (zero books)", () => {
    it("renders nothing: no 'add a book' banner, no failure copy, no 'nothing due' card", () => {
      const { container } = render(<SessionEntryCard dueSummary={due({ hasBooks: false })} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText("Add a book to get started")).not.toBeInTheDocument();
      expect(screen.queryByText("Add book")).not.toBeInTheDocument();
      expect(screen.queryByText(/starter deck/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Retry")).not.toBeInTheDocument();
      expect(screen.queryByText("Nothing due today")).not.toBeInTheDocument();
    });

    it("positive control: the same component with a book DOES render its card", () => {
      render(<SessionEntryCard dueSummary={due({ hasBooks: true, newCount: 3, estimatedMinutes: 4 })} />);
      expect(screen.getByRole("button", { name: /ready to start/ })).toBeInTheDocument();
    });
  });
});
