import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetrievalSessionOverlay } from "../retrieval-session-overlay";
import type { BuiltSession, SessionCard } from "@/lib/self-mastery/session/types";

const loadTodaysSessionMock = vi.fn();
const revealCardAnswerMock = vi.fn();
const fetchCurrentCardStateMock = vi.fn();
const finishSessionMock = vi.fn();
const logSelfExplanationMock = vi.fn();
const revalidateAfterReviewMock = vi.fn();

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
  revealCardAnswer: (cardId: string) => revealCardAnswerMock(cardId),
  fetchCurrentCardState: (cardId: string) => fetchCurrentCardStateMock(cardId),
  finishSession: (sessionId: string) => finishSessionMock(sessionId),
  logSelfExplanation: (input: unknown) => logSelfExplanationMock(input),
  revalidateAfterReview: () => revalidateAfterReviewMock(),
}));

const enqueuePendingReviewMock = vi.fn(async (_storage: unknown, _review: unknown) => undefined);
const replayPendingReviewsMock = vi.fn(async (_client: unknown, _storage: unknown, _sessionId: string) => ({
  succeeded: ["queued-1"],
  failures: [] as { id: string; cardId: string; error: string; classification: string }[],
}));

vi.mock("@/lib/self-mastery/session/offline-queue", () => ({
  enqueuePendingReview: (storage: unknown, review: unknown) => enqueuePendingReviewMock(storage, review),
  replayPendingReviews: (client: unknown, storage: unknown, sessionId: string) =>
    replayPendingReviewsMock(client, storage, sessionId),
  localStorageAdapter: {},
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

function card(id: string, prompt: string, reason: SessionCard["reason"] = "due"): SessionCard {
  return { id, lessonId: `lesson-${id}`, bookId: "book-1", promptType: "free_recall", prompt, reason, queuePosition: 0 };
}

function builtSession(cards: SessionCard[]): BuiltSession {
  return {
    session: { id: "sess-1", userId: "user-1", localDate: "2026-09-01", startedAt: "2026-09-01T12:00:00Z", endedAt: null, cardsReviewed: 0, newCardsIntroduced: 0 },
    plan: { warmUp: [], due: cards, fresh: [], closer: null },
    settings: { sessionTargetMinutes: 8, dailyNewLimit: 5, aiGradingEnabled: true, desiredRetention: 0.9 },
    overflowDueCount: 0,
  };
}

describe("RetrievalSessionOverlay", () => {
  beforeEach(() => {
    loadTodaysSessionMock.mockReset();
    revealCardAnswerMock.mockReset();
    fetchCurrentCardStateMock.mockReset();
    finishSessionMock.mockReset();
    logSelfExplanationMock.mockReset();
    revalidateAfterReviewMock.mockReset();
    enqueuePendingReviewMock.mockClear();
    replayPendingReviewsMock.mockReset();
    fetchCurrentCardStateMock.mockResolvedValue(null);
    replayPendingReviewsMock.mockResolvedValue({ succeeded: ["queued-1"], failures: [] });
  });

  it("renders nothing when closed, without loading a session", () => {
    render(<RetrievalSessionOverlay open={false} onClose={vi.fn()} />);
    expect(loadTodaysSessionMock).not.toHaveBeenCalled();
  });

  it("shows the empty ('nothing due today') success state for a plan with no cards at all", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([]));
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Nothing due today.")).toBeInTheDocument());
  });

  it("shows an error state and never crashes when loading fails", async () => {
    loadTodaysSessionMock.mockRejectedValue(new Error("network"));
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Couldn.t load today.s session/)).toBeInTheDocument());
  });

  it("shows the first card's prompt without ever fetching its answer", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "What is the generation effect?")]));
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("What is the generation effect?")).toBeInTheDocument());
    expect(revealCardAnswerMock).not.toHaveBeenCalled();
  });

  it("only fetches the answer after Reveal is tapped -- the non-negotiable invariant, at the component boundary", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Prompt one")]));
    revealCardAnswerMock.mockResolvedValue("The real answer");
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Prompt one")).toBeInTheDocument());
    expect(screen.queryByText("The real answer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal answer" }));

    expect(revealCardAnswerMock).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(screen.getByText("The real answer")).toBeInTheDocument());
  });

  it("grading calls gradeCard with the session id, card id, rating, and typed answer, then finishes on the last card", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
    revealCardAnswerMock.mockResolvedValue("Answer text");
    finishSessionMock.mockResolvedValue({
      currentStreak: 1,
      longestStreak: 1,
      freezesAvailable: 0,
      totalReviews: 1,
      totalSessions: 1,
      freezeConsumed: null,
      effortfulWin: null,
      dueTomorrow: 0,
    });
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/Type what you remember/), "my recall");
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByText("Answer text")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Good" }));

    expect(fetchCurrentCardStateMock).toHaveBeenCalledWith("c1");
    expect(enqueuePendingReviewMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ cardId: "c1", rating: 3, answeredText: "my recall" })
    );
    expect(replayPendingReviewsMock).toHaveBeenCalledWith({}, {}, "sess-1");
    await waitFor(() => expect(finishSessionMock).toHaveBeenCalledWith("sess-1"));
    await waitFor(() => expect(screen.getByText("Session complete.")).toBeInTheDocument());
  });

  it("an empty typed answer is submitted as-is, never blocked", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
    revealCardAnswerMock.mockResolvedValue("Answer text");
    finishSessionMock.mockResolvedValue({
      currentStreak: 1,
      longestStreak: 1,
      freezesAvailable: 0,
      totalReviews: 1,
      totalSessions: 1,
      freezeConsumed: null,
      effortfulWin: null,
      dueTomorrow: 2,
    });
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Again" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Again" }));

    expect(enqueuePendingReviewMock).toHaveBeenCalledWith({}, expect.objectContaining({ answeredText: "", rating: 1 }));
  });

  it("session-complete shows a real effortful-win callout when the RPC reports one, never fabricated when it doesn't", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
    revealCardAnswerMock.mockResolvedValue("Answer text");
    finishSessionMock.mockResolvedValue({
      currentStreak: 4,
      longestStreak: 4,
      freezesAvailable: 2,
      totalReviews: 20,
      totalSessions: 4,
      freezeConsumed: null,
      effortfulWin: { kind: "deck_complete", bookId: "b1", bookTitle: "Meditations" },
      dueTomorrow: 3,
    });
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Easy" }));

    await waitFor(() => expect(screen.getByText(/Meditations/)).toBeInTheDocument());
    expect(screen.getByText("3 cards due tomorrow.")).toBeInTheDocument();
  });

  describe("offline queue integration", () => {
    it("a transient (offline) failure never blocks the session -- the card advances and the session finishes normally", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      replayPendingReviewsMock.mockResolvedValue({
        succeeded: [],
        failures: [{ id: "queued-1", cardId: "c1", error: "Failed to fetch", classification: "transient-retrying" }],
      });
      finishSessionMock.mockResolvedValue({
        currentStreak: 1,
        longestStreak: 1,
        freezesAvailable: 0,
        totalReviews: 0,
        totalSessions: 1,
        freezeConsumed: null,
        effortfulWin: null,
        dueTomorrow: 0,
      });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Good" }));

      await waitFor(() => expect(screen.getByText("Session complete.")).toBeInTheDocument());
      expect(screen.queryByText(/couldn.t be saved/i)).not.toBeInTheDocument();
    });

    it("a permanent failure surfaces a real error to the user rather than pretending the review saved", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt"), card("c2", "Second")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      // First call is the mount-flush effect (nothing queued yet); the
      // SECOND call is the one handleGrade triggers after enqueueing --
      // that's the one that must report the permanent failure.
      replayPendingReviewsMock.mockResolvedValueOnce({ succeeded: [], failures: [] }).mockResolvedValueOnce({
        succeeded: [],
        failures: [{ id: "queued-1", cardId: "c1", error: "submit_review: rating must be 1..4", classification: "permanent" }],
      });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Good" }));

      await waitFor(() => expect(screen.getByText(/couldn.t be saved/i)).toBeInTheDocument());
      // Still advances -- one card's permanent failure doesn't strand the rest of the session.
      await waitFor(() => expect(screen.getByText("Second")).toBeInTheDocument());
    });

    it("flushes any leftover queued reviews from an earlier interrupted session as soon as the session id is known", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(replayPendingReviewsMock).toHaveBeenCalledWith({}, {}, "sess-1"));
    });
  });
});
