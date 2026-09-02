import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionEntryCard } from "../session-entry-card";

const loadTodaysSessionMock = vi.fn(async () => new Promise(() => {})); // never resolves -- just proving it opens
const retryStarterDeckSeedMock = vi.fn();

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
  retryStarterDeckSeed: () => retryStarterDeckSeedMock(),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function due(overrides: Partial<{ dueCount: number; newCount: number; estimatedMinutes: number; starterDeckMissing: boolean }>) {
  return { dueCount: 0, newCount: 0, estimatedMinutes: 0, starterDeckMissing: false, ...overrides };
}

describe("SessionEntryCard", () => {
  beforeEach(() => {
    loadTodaysSessionMock.mockClear();
    retryStarterDeckSeedMock.mockReset();
    refreshMock.mockClear();
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

  // Boss ruling, R7: a starter-deck seed that never landed must be visible
  // and recoverable, never silently identical to "you're caught up."
  describe("starterDeckMissing (a seed that never landed, or was never attempted)", () => {
    it("renders its own distinct copy -- never the caught-up state's copy", () => {
      render(<SessionEntryCard dueSummary={due({ starterDeckMissing: true })} />);
      expect(screen.getByText("Your starter deck didn't load")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
      expect(screen.queryByText("Nothing due today")).not.toBeInTheDocument();
      expect(screen.queryByText("Review anyway")).not.toBeInTheDocument();
    });

    it("tapping it retries the seed instead of opening the session overlay", async () => {
      retryStarterDeckSeedMock.mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      render(<SessionEntryCard dueSummary={due({ starterDeckMissing: true })} />);

      await user.click(screen.getByRole("button", { name: /starter deck/ }));

      expect(retryStarterDeckSeedMock).toHaveBeenCalled();
      expect(loadTodaysSessionMock).not.toHaveBeenCalled();
    });

    it("a successful retry refreshes Home so the card can flip out of the failed state", async () => {
      retryStarterDeckSeedMock.mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      render(<SessionEntryCard dueSummary={due({ starterDeckMissing: true })} />);

      await user.click(screen.getByRole("button", { name: /starter deck/ }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    });

    it("a failed retry shows an inline message and stays retryable, never crashes or opens the overlay", async () => {
      retryStarterDeckSeedMock.mockResolvedValue({ ok: false });
      const user = userEvent.setup();
      render(<SessionEntryCard dueSummary={due({ starterDeckMissing: true })} />);

      await user.click(screen.getByRole("button", { name: /starter deck/ }));

      await waitFor(() => expect(screen.getByText(/couldn't/i)).toBeInTheDocument());
      expect(refreshMock).not.toHaveBeenCalled();
      expect(loadTodaysSessionMock).not.toHaveBeenCalled();
      // Still tappable -- the retry itself failing must not strand the user.
      expect(screen.getByRole("button", { name: /starter deck/ })).not.toBeDisabled();
    });
  });
});
