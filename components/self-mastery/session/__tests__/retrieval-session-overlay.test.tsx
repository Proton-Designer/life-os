import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetrievalSessionOverlay } from "../retrieval-session-overlay";
import type { BuiltSession, SessionCard } from "@/lib/self-mastery/session/types";

const loadTodaysSessionMock = vi.fn();
const revealCardAnswerMock = vi.fn();
const revealLessonContextMock = vi.fn();
const fetchCurrentCardStateMock = vi.fn();
const finishSessionMock = vi.fn();
const logSelfExplanationMock = vi.fn();
const revalidateAfterReviewMock = vi.fn();

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
  revealCardAnswer: (cardId: string) => revealCardAnswerMock(cardId),
  revealLessonContext: (lessonId: string) => revealLessonContextMock(lessonId),
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

const getAnswerFeedbackMock = vi.fn(async (_cardId: string, _userAnswer: string): Promise<{ feedback: string; suggestedRating: 1 | 2 | 3 | 4 | null } | null> => null);
vi.mock("@/app/(app)/personal/answer-feedback-actions", () => ({
  getAnswerFeedback: (cardId: string, userAnswer: string) => getAnswerFeedbackMock(cardId, userAnswer),
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
    revealLessonContextMock.mockReset();
    revealLessonContextMock.mockResolvedValue({ mechanism: null, actionTemplate: null }); // the common case: not every lesson has both fields
    fetchCurrentCardStateMock.mockReset();
    finishSessionMock.mockReset();
    logSelfExplanationMock.mockReset();
    revalidateAfterReviewMock.mockReset();
    enqueuePendingReviewMock.mockClear();
    replayPendingReviewsMock.mockReset();
    fetchCurrentCardStateMock.mockResolvedValue(null);
    replayPendingReviewsMock.mockResolvedValue({ succeeded: ["queued-1"], failures: [] });
    getAnswerFeedbackMock.mockReset();
    getAnswerFeedbackMock.mockResolvedValue(null); // the default state for the overwhelming majority of users -- no key
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

  describe("AI answer feedback (opt-in, user's own key)", () => {
    it("is called ONLY after reveal, never before -- with the card id and the exact answer the user typed", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.type(screen.getByPlaceholderText(/Type what you remember/), "my recall");
      expect(getAnswerFeedbackMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(getAnswerFeedbackMock).toHaveBeenCalledWith("c1", "my recall"));
    });

    it("null (no key / provider down / rate-limited / malformed) renders NOTHING -- no empty state, no prompt to add a key, screen indistinguishable from before this feature existed", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      getAnswerFeedbackMock.mockResolvedValue(null);
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(getAnswerFeedbackMock).toHaveBeenCalled());

      // Give the resolved (null) promise a tick to apply, then assert
      // absence of every trace this feature could leave.
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());
      expect(screen.queryByText(/AI suggests/)).not.toBeInTheDocument();
      expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/add.*key/i)).not.toBeInTheDocument();
    });

    it("a rejected request (network failure) also renders nothing -- same as any other null path, never surfaced as an error", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      getAnswerFeedbackMock.mockRejectedValue(new Error("network"));
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(getAnswerFeedbackMock).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/AI suggests/)).not.toBeInTheDocument();
    });

    it("renders the feedback text and the suggested rating as a hint once it arrives", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      getAnswerFeedbackMock.mockResolvedValue({ feedback: "You had the core idea but missed the mechanism.", suggestedRating: 3 });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(screen.getByText("You had the core idea but missed the mechanism.")).toBeInTheDocument());
      expect(screen.getByText("AI suggests: Good")).toBeInTheDocument();
    });

    it("a suggestedRating hint never preselects or auto-submits a grade -- every grade button stays independently clickable", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      getAnswerFeedbackMock.mockResolvedValue({ feedback: "Close.", suggestedRating: 4 });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByText("AI suggests: Easy")).toBeInTheDocument());
      expect(enqueuePendingReviewMock).not.toHaveBeenCalled();
      // The user's own tap, not the suggestion, is what grades it.
      await user.click(screen.getByRole("button", { name: "Hard" }));
      expect(enqueuePendingReviewMock).toHaveBeenCalledWith({}, expect.objectContaining({ rating: 2 }));
    });

    it("is fired-and-forgotten, never delayed or blocked: grading proceeds immediately even while the request is still pending", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      let resolveFeedback: (v: null) => void = () => {};
      getAnswerFeedbackMock.mockReturnValue(new Promise((resolve) => { resolveFeedback = resolve; }));
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());

      // Grade WITHOUT ever resolving the feedback request.
      await user.click(screen.getByRole("button", { name: "Good" }));
      await waitFor(() => expect(enqueuePendingReviewMock).toHaveBeenCalled());
      expect(enqueuePendingReviewMock).toHaveBeenCalledWith({}, expect.objectContaining({ aiFeedback: null, aiSuggestedRating: null }));

      // Late arrival, after the user already moved past this card, must
      // not throw or paint onto the session-complete screen.
      resolveFeedback(null);
    });

    it("persists the feedback into the enqueued review when it arrives before grading", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      getAnswerFeedbackMock.mockResolvedValue({ feedback: "Solid recall.", suggestedRating: 3 });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByText("AI suggests: Good")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Easy" }));

      expect(enqueuePendingReviewMock).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ aiFeedback: "Solid recall.", aiSuggestedRating: 3, rating: 4 })
      );
    });
  });

  describe("lesson context on card reveal (mechanism / action_template, read-only)", () => {
    it("is called ONLY after reveal, never before -- with the card's lessonId", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      expect(revealLessonContextMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(revealLessonContextMock).toHaveBeenCalledWith("lesson-c1"));
    });

    it("renders mechanism as 'Why it works' and actionTemplate as 'Try this' once both arrive", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      revealLessonContextMock.mockResolvedValue({
        mechanism: "Spaced repetition beats cramming because it exploits the forgetting curve.",
        actionTemplate: "This week, review one card daily instead of all at once.",
      });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      expect(await screen.findByText("Why it works")).toBeInTheDocument();
      expect(screen.getByText("Spaced repetition beats cramming because it exploits the forgetting curve.")).toBeInTheDocument();
      expect(screen.getByText("Try this")).toBeInTheDocument();
      expect(screen.getByText("This week, review one card daily instead of all at once.")).toBeInTheDocument();
    });

    it("a lesson with neither field renders neither section -- a real, non-error state, never fabricated", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      revealLessonContextMock.mockResolvedValue({ mechanism: null, actionTemplate: null });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());
      expect(screen.queryByText("Why it works")).not.toBeInTheDocument();
      expect(screen.queryByText("Try this")).not.toBeInTheDocument();
    });

    it("only mechanism present renders only 'Why it works', not an empty 'Try this' section", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      revealLessonContextMock.mockResolvedValue({ mechanism: "It works because of X.", actionTemplate: null });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      expect(await screen.findByText("Why it works")).toBeInTheDocument();
      expect(screen.queryByText("Try this")).not.toBeInTheDocument();
    });

    it("a rejected lesson-context request never blocks or errors reveal -- the answer still shows, no alert", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Only prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      revealLessonContextMock.mockRejectedValue(new Error("network"));
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(screen.getByText("Answer text")).toBeInTheDocument());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("Why it works")).not.toBeInTheDocument();
      expect(screen.queryByText("Try this")).not.toBeInTheDocument();
    });

    it("resets between cards -- a stale mechanism from the previous card never bleeds onto the next one", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "First prompt"), card("c2", "Second prompt")]));
      revealCardAnswerMock.mockResolvedValue("Answer text");
      revealLessonContextMock.mockResolvedValueOnce({ mechanism: "First mechanism.", actionTemplate: null });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("First prompt")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      expect(await screen.findByText("First mechanism.")).toBeInTheDocument();

      revealLessonContextMock.mockResolvedValue({ mechanism: null, actionTemplate: null });
      await user.click(screen.getByRole("button", { name: "Good" }));

      await waitFor(() => expect(screen.getByText("Second prompt")).toBeInTheDocument());
      expect(screen.queryByText("First mechanism.")).not.toBeInTheDocument();
    });
  });
});
