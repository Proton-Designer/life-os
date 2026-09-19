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

  // ONB item 11: the automatic Marcus Aurelius starter-deck seed onboarding
  // used to create is gone, so zero books is now always a genuine empty
  // state -- never a failure signal. This is the exact regression this task
  // risks: a zero-books user must NEVER see the old "Your starter deck
  // didn't load" / "Retry" copy, which would now be permanently wrong for
  // every new Self-Mastery user (there is no seed left to fail).
  describe("empty library (zero books -- no starter deck was ever auto-created)", () => {
    it("shows an honest 'add a book' prompt, never the old failure/retry copy", () => {
      render(<SessionEntryCard dueSummary={due({ hasBooks: false })} />);
      expect(screen.getByText("Add a book to get started")).toBeInTheDocument();
      expect(screen.getByText("Add book")).toBeInTheDocument();
      // The regression control: none of the old starter-deck-failure UI survives.
      expect(screen.queryByText(/starter deck/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Retry")).not.toBeInTheDocument();
      expect(screen.queryByText("Nothing due today")).not.toBeInTheDocument();
      expect(screen.queryByText("Review anyway")).not.toBeInTheDocument();
    });

    it("tapping it navigates to the standalone legacy library by default (no selfMasteryHref given)", async () => {
      const user = userEvent.setup();
      render(<SessionEntryCard dueSummary={due({ hasBooks: false })} />);

      await user.click(screen.getByRole("button", { name: /add a book/i }));

      expect(pushMock).toHaveBeenCalledWith("/self-mastery");
      expect(loadTodaysSessionMock).not.toHaveBeenCalled();
    });

    // Home bug: this banner used to hardcode "/self-mastery" regardless of
    // account mode, so a domains-mode account landed on the standalone
    // legacy page with no Personal tab switcher, instead of the Personal
    // section's own Self-Mastery tab. The href is now computed by the
    // caller (app/(app)/page.tsx, from getUserDomains()'s mode) and passed
    // straight through here.
    it("tapping it navigates to the domains-mode Personal tab when the caller supplies that href", async () => {
      const user = userEvent.setup();
      render(<SessionEntryCard dueSummary={due({ hasBooks: false })} selfMasteryHref="/personal/self_mastery" />);

      await user.click(screen.getByRole("button", { name: /add a book/i }));

      expect(pushMock).toHaveBeenCalledWith("/personal/self_mastery");
    });
  });
});
