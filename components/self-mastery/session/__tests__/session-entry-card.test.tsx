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
    render(<SessionEntryCard dueSummary={{ dueCount: 12, estimatedMinutes: 7 }} />);
    expect(screen.getByText("12 cards due, ~7 min")).toBeInTheDocument();
  });

  it("singularizes 'card' for exactly one due", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 1, estimatedMinutes: 2 }} />);
    expect(screen.getByText("1 card due, ~2 min")).toBeInTheDocument();
  });

  it("shows the caught-up copy when nothing is due, still tappable", () => {
    render(<SessionEntryCard dueSummary={{ dueCount: 0, estimatedMinutes: 0 }} />);
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
  });

  it("tapping the card opens the session overlay (loadTodaysSession fires, not blocked)", async () => {
    const user = userEvent.setup();
    render(<SessionEntryCard dueSummary={{ dueCount: 3, estimatedMinutes: 5 }} />);

    await user.click(screen.getByRole("button", { name: /cards due/ }));

    expect(loadTodaysSessionMock).toHaveBeenCalled();
  });
});
