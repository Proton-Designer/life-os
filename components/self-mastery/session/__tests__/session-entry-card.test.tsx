import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionEntryCard } from "../session-entry-card";

const loadTodaysSessionMock = vi.fn(async () => new Promise(() => {})); // never resolves -- just proving it opens

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
}));

describe("SessionEntryCard", () => {
  it("renders nothing when dueSummary is null (unauthenticated/render-path degrade)", () => {
    const { container } = render(<SessionEntryCard dueSummary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the due count and estimated minutes", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 12, newCount: 0, estimatedMinutes: 7 }} />);
    expect(screen.getByText("12 cards due, ~7 min")).toBeInTheDocument();
  });

  it("singularizes 'card' for exactly one due", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 1, newCount: 0, estimatedMinutes: 2 }} />);
    expect(screen.getByText("1 card due, ~2 min")).toBeInTheDocument();
  });

  it("shows the caught-up copy when nothing is due and nothing is new, still tappable", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 0, newCount: 0, estimatedMinutes: 0 }} />);
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
    expect(screen.getByText("Review anyway")).toBeInTheDocument();
  });

  it("shows 'ready to start' copy for a fresh deck with nothing due yet -- day one must not read as broken", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 0, newCount: 12, estimatedMinutes: 8 }} />);
    expect(screen.getByText("12 cards ready to start, ~8 min")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing due/)).not.toBeInTheDocument();
  });

  it("prefers due copy over new-card copy when both are non-zero", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 3, newCount: 5, estimatedMinutes: 6 }} />);
    expect(screen.getByText("3 cards due, ~6 min")).toBeInTheDocument();
    expect(screen.queryByText(/ready to start/)).not.toBeInTheDocument();
  });

  it("tapping the card opens the session overlay (loadTodaysSession fires, not blocked)", async () => {
    const user = userEvent.setup();
    render(<SessionEntryCard dueSummary={{ dueCount: 3, newCount: 0, estimatedMinutes: 5 }} />);

    await user.click(screen.getByRole("button", { name: /cards due/ }));

    expect(loadTodaysSessionMock).toHaveBeenCalled();
  });
});
