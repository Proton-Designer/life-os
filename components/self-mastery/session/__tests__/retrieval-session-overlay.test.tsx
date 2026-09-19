import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetrievalSessionOverlay } from "../retrieval-session-overlay";
import type { BuiltSession, SessionCard, SessionQuestion } from "@/lib/self-mastery/session/types";

const loadTodaysSessionMock = vi.fn();
const revealCardAnswerMock = vi.fn();
const revealQuestionAnswerMock = vi.fn();
const revealLessonContextMock = vi.fn();
const fetchCurrentCardStateMock = vi.fn();
const gradeQuestionMock = vi.fn();
const finishSessionMock = vi.fn();
const logSelfExplanationMock = vi.fn();
const revalidateAfterReviewMock = vi.fn();

vi.mock("@/app/(app)/personal/self-mastery-session-actions", () => ({
  loadTodaysSession: () => loadTodaysSessionMock(),
  revealCardAnswer: (cardId: string) => revealCardAnswerMock(cardId),
  revealQuestionAnswer: (questionId: string) => revealQuestionAnswerMock(questionId),
  revealLessonContext: (lessonId: string) => revealLessonContextMock(lessonId),
  fetchCurrentCardState: (cardId: string) => fetchCurrentCardStateMock(cardId),
  gradeQuestion: (input: unknown) => gradeQuestionMock(input),
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

const getCloserDayConnectionMock = vi.fn(async (_cardId: string): Promise<string | null> => null);
vi.mock("@/app/(app)/personal/closer-day-connection-actions", () => ({
  getCloserDayConnection: (cardId: string) => getCloserDayConnectionMock(cardId),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

function card(id: string, prompt: string, reason: SessionCard["reason"] = "due", queuePosition = 0): SessionCard {
  return { id, lessonId: `lesson-${id}`, bookId: "book-1", promptType: "free_recall", prompt, reason, queuePosition };
}

function question(id: string, prompt: string, reason: SessionQuestion["reason"] = "due", queuePosition = 0): SessionQuestion {
  return { id, classId: "class-1", prompt, reason, queuePosition };
}

function builtSession(
  cards: SessionCard[],
  dueQuestions: SessionQuestion[] = [],
  examIntensity: BuiltSession["examIntensity"] = null
): BuiltSession {
  return {
    session: { id: "sess-1", userId: "user-1", localDate: "2026-09-01", startedAt: "2026-09-01T12:00:00Z", endedAt: null, cardsReviewed: 0, newCardsIntroduced: 0 },
    plan: { warmUp: [], due: cards, fresh: [], closer: null },
    settings: { sessionTargetMinutes: 8, dailyNewLimit: 5, aiGradingEnabled: true, desiredRetention: 0.9 },
    overflowDueCount: 0,
    dueQuestions,
    examIntensity,
  };
}

describe("RetrievalSessionOverlay", () => {
  beforeEach(() => {
    loadTodaysSessionMock.mockReset();
    revealCardAnswerMock.mockReset();
    revealQuestionAnswerMock.mockReset();
    revealLessonContextMock.mockReset();
    revealLessonContextMock.mockResolvedValue({ mechanism: null, actionTemplate: null }); // the common case: not every lesson has both fields
    fetchCurrentCardStateMock.mockReset();
    gradeQuestionMock.mockReset();
    gradeQuestionMock.mockResolvedValue({ scheduledDays: 1 });
    finishSessionMock.mockReset();
    logSelfExplanationMock.mockReset();
    revalidateAfterReviewMock.mockReset();
    enqueuePendingReviewMock.mockClear();
    replayPendingReviewsMock.mockReset();
    fetchCurrentCardStateMock.mockResolvedValue(null);
    replayPendingReviewsMock.mockResolvedValue({ succeeded: ["queued-1"], failures: [] });
    getAnswerFeedbackMock.mockReset();
    getAnswerFeedbackMock.mockResolvedValue(null); // the default state for the overwhelming majority of users -- no key
    getCloserDayConnectionMock.mockReset();
    getCloserDayConnectionMock.mockResolvedValue(null);
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

  // Phase 1 #27's own gap, closed: the exam-intensity multiplier was wired
  // into scheduling capacity but named nowhere a user could see. This is the
  // one surface that shows it, in plain language, honestly reflecting
  // BuiltSession.examIntensity -- never a second computation of it.
  it("names the exam-intensity countdown and boost when the session was built with one", async () => {
    loadTodaysSessionMock.mockResolvedValue(
      builtSession([card("c1", "A card")], [], { daysUntilExam: 2, multiplier: 2.5, assessmentName: "Midterm 1", assessmentType: "exam" })
    );
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Exam in 2 days — study capacity boosted 2.5×")).toBeInTheDocument());
  });

  it("shows no exam-intensity banner at all when the session has none", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "A card")], [], null));
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("A card")).toBeInTheDocument());
    expect(screen.queryByText(/study capacity boosted/)).not.toBeInTheDocument();
  });

  it("P2-16: offers no Dictate control when the browser has no SpeechRecognition, and shows/wires one that appends to the typed answer when it does", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Dictation prompt")]));
    const user = userEvent.setup();
    const { unmount } = render(<RetrievalSessionOverlay open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Dictation prompt")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Dictate" })).not.toBeInTheDocument();
    unmount();

    class FakeSpeechRecognition {
      lang = "";
      interimResults = false;
      onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: { 0: { 0: { transcript: "hippocampus" } } } });
        this.onend?.();
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeSpeechRecognition);
    try {
      loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Dictation prompt")]));
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("Dictation prompt")).toBeInTheDocument());

      await user.type(screen.getByPlaceholderText(/Type what you remember/), "the");
      await user.click(screen.getByRole("button", { name: "Dictate" }));

      expect(screen.getByPlaceholderText(/Type what you remember/)).toHaveValue("the hippocampus");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("P2-15: an ordinary card never requests a closer day-connection, even after reveal", async () => {
    loadTodaysSessionMock.mockResolvedValue(builtSession([card("c1", "Ordinary prompt"), card("c2", "Second prompt")]));
    revealCardAnswerMock.mockResolvedValue("An answer");
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Ordinary prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByText("An answer")).toBeInTheDocument());

    expect(getCloserDayConnectionMock).not.toHaveBeenCalled();
  });

  it("P2-15: the closer card requests a day-connection, and shows it under 'Today' once it resolves with a real one", async () => {
    const closerCard = card("c-closer", "Closer prompt");
    loadTodaysSessionMock.mockResolvedValue({
      session: { id: "sess-1", userId: "user-1", localDate: "2026-09-01", startedAt: "2026-09-01T12:00:00Z", endedAt: null, cardsReviewed: 0, newCardsIntroduced: 0 },
      plan: { warmUp: [], due: [], fresh: [], closer: closerCard },
      settings: { sessionTargetMinutes: 8, dailyNewLimit: 5, aiGradingEnabled: true, desiredRetention: 0.9 },
      overflowDueCount: 0,
      dueQuestions: [],
    });
    revealCardAnswerMock.mockResolvedValue("Closer answer");
    getCloserDayConnectionMock.mockResolvedValue("This connects to Problem Set 3, due today.");
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Closer prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByText("Closer answer")).toBeInTheDocument());

    expect(getCloserDayConnectionMock).toHaveBeenCalledWith("c-closer");
    await waitFor(() => expect(screen.getByText("This connects to Problem Set 3, due today.")).toBeInTheDocument());
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("P2-15: the closer card shows nothing extra when there's no genuine day-connection (no key, cap hit, or nothing due) -- never a placeholder", async () => {
    const closerCard = card("c-closer", "Closer prompt");
    loadTodaysSessionMock.mockResolvedValue({
      session: { id: "sess-1", userId: "user-1", localDate: "2026-09-01", startedAt: "2026-09-01T12:00:00Z", endedAt: null, cardsReviewed: 0, newCardsIntroduced: 0 },
      plan: { warmUp: [], due: [], fresh: [], closer: closerCard },
      settings: { sessionTargetMinutes: 8, dailyNewLimit: 5, aiGradingEnabled: true, desiredRetention: 0.9 },
      overflowDueCount: 0,
      dueQuestions: [],
    });
    revealCardAnswerMock.mockResolvedValue("Closer answer");
    getCloserDayConnectionMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Closer prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByText("Closer answer")).toBeInTheDocument());
    await waitFor(() => expect(getCloserDayConnectionMock).toHaveBeenCalledWith("c-closer"));

    expect(screen.queryByText("Today")).not.toBeInTheDocument();
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
      studyMethods: [],
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
      studyMethods: [],
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
      studyMethods: [],
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

  // P3-03: one compact line naming the taxonomy's own labels (Opus Lead
  // ruling: same vocabulary everywhere, and nothing rendered for an empty
  // array -- clutter was tonight's product complaint, so this must never
  // become a row of greyed-out unavailable modes).
  it("session-complete shows a single compact line of study-method labels when the session recorded any", async () => {
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
      studyMethods: ["retrieval", "interleave"],
    });
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Easy" }));

    await waitFor(() => expect(screen.getByText("Session complete.")).toBeInTheDocument());
    expect(screen.getByText("Retrieval · Interleave")).toBeInTheDocument();
  });

  it("session-complete renders no study-method line at all when the session recorded none", async () => {
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
      studyMethods: [],
    });
    const user = userEvent.setup();
    render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Only prompt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Easy" }));

    await waitFor(() => expect(screen.getByText("Session complete.")).toBeInTheDocument());
    // "Retrieval" alone would also match the dialog's own sr-only title
    // ("Retrieval session") -- Interleave/Draft have no such collision and
    // are enough to prove no chip line rendered.
    expect(screen.queryByText(/Interleave|Draft/)).not.toBeInTheDocument();
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
        studyMethods: [],
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

  // Phase 1 #25/#26: question-backed turns, interleaved by queue_position
  // with cards, revealed/graded through their own question-path actions.
  describe("question-backed turns (Phase 1 #25/#26)", () => {
    it("interleaves a due question between two due cards by queue_position, not appended after them", async () => {
      loadTodaysSessionMock.mockResolvedValue(
        builtSession(
          [card("c1", "Card one", "due", 0), card("c2", "Card two", "due", 2)],
          [question("q1", "Question one", "due", 1)]
        )
      );
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Card one")).toBeInTheDocument());
      revealCardAnswerMock.mockResolvedValue("Card one answer");
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Good" }));

      // Position 1 is the question, sorted ahead of Card two's position 2.
      await waitFor(() => expect(screen.getByText("Question one")).toBeInTheDocument());
    });

    it("shows a question's prompt without ever fetching its answer, same reveal-on-commit invariant as a card", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([], [question("q1", "What is FSRS?")]));
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("What is FSRS?")).toBeInTheDocument());
      expect(revealQuestionAnswerMock).not.toHaveBeenCalled();
      expect(revealCardAnswerMock).not.toHaveBeenCalled();
    });

    it("Reveal calls revealQuestionAnswer (not revealCardAnswer) for a question-backed turn, and shows no lesson-context sections", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([], [question("q1", "What is FSRS?")]));
      revealQuestionAnswerMock.mockResolvedValue("Free Spaced Repetition Scheduler");
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("What is FSRS?")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));

      await waitFor(() => expect(screen.getByText("Free Spaced Repetition Scheduler")).toBeInTheDocument());
      expect(revealQuestionAnswerMock).toHaveBeenCalledWith("q1");
      expect(revealCardAnswerMock).not.toHaveBeenCalled();
      expect(revealLessonContextMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Why it works")).not.toBeInTheDocument();
      expect(screen.queryByText("Try this")).not.toBeInTheDocument();
    });

    it("grading a question calls gradeQuestion (not the offline card queue) with the question id, session id, rating, and typed answer", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([], [question("q1", "What is FSRS?")]));
      revealQuestionAnswerMock.mockResolvedValue("Free Spaced Repetition Scheduler");
      finishSessionMock.mockResolvedValue({
        currentStreak: 1, longestStreak: 1, freezesAvailable: 0, totalReviews: 1, totalSessions: 1,
        freezeConsumed: null, effortfulWin: null, dueTomorrow: 0, studyMethods: [],
      });
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("What is FSRS?")).toBeInTheDocument());
      await user.type(screen.getByPlaceholderText(/Type what you remember/), "my recall");
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByText("Free Spaced Repetition Scheduler")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Good" }));

      expect(gradeQuestionMock).toHaveBeenCalledWith(
        expect.objectContaining({ questionId: "q1", sessionId: "sess-1", rating: 3, answeredText: "my recall" })
      );
      expect(enqueuePendingReviewMock).not.toHaveBeenCalled();
      expect(fetchCurrentCardStateMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getByText("Session complete.")).toBeInTheDocument());
    });

    // THE required condition (Opus Lead): no offline queue for questions in
    // this pass, so a failed submit must be VISIBLE and must preserve the
    // user's typed answer for retry -- never a silent drop, never a reset
    // to a blank field.
    it("a failed question submit shows a visible error, does NOT advance, and keeps the user's typed answer for retry", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([], [question("q1", "What is FSRS?")]));
      revealQuestionAnswerMock.mockResolvedValue("Free Spaced Repetition Scheduler");
      gradeQuestionMock.mockRejectedValueOnce(new Error("submit_question_review: no card_states row for question q1 / user u1"));
      const user = userEvent.setup();
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("What is FSRS?")).toBeInTheDocument());
      await user.type(screen.getByPlaceholderText(/Type what you remember/), "my recall");
      await user.click(screen.getByRole("button", { name: "Reveal answer" }));
      await waitFor(() => expect(screen.getByText("Free Spaced Repetition Scheduler")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Good" }));

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      // Still on the SAME question, not advanced past it.
      expect(screen.getByText("What is FSRS?")).toBeInTheDocument();
      // The typed answer is still in the textbox, ready for a retry.
      expect(screen.getByPlaceholderText(/Type what you remember/)).toHaveValue("my recall");
      // The grade buttons are still live -- a retry is possible.
      expect(screen.getByRole("button", { name: "Good" })).not.toBeDisabled();
    });

    it("a School-only user with zero cards but real due questions gets a real session, not the empty state", async () => {
      loadTodaysSessionMock.mockResolvedValue(builtSession([], [question("q1", "School-only question")]));
      render(<RetrievalSessionOverlay open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("School-only question")).toBeInTheDocument());
      expect(screen.queryByText("Nothing due today.")).not.toBeInTheDocument();
    });
  });
});
