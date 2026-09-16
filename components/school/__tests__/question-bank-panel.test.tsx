import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuestionBankPanel, type QuestionBankQuestion, type QuestionBankLecture } from "../question-bank-panel";

// jsdom has no ResizeObserver, and this form is the first school test to
// render components/ui/switch.tsx (Radix Switch -> @radix-ui/react-use-size
// calls it unconditionally on mount). vitest.setup.ts already stubs a few
// other jsdom/Radix gaps (hasPointerCapture, scrollIntoView) globally for
// exactly this reason -- this one is scoped to this file rather than added
// there, since vitest.setup.ts sits outside this engineer's owned
// directories (lib/school/**, components/school/**, app/(app)/school/**).
// Flagged to the coordinator: promoting this stub into vitest.setup.ts
// would benefit any future Switch-rendering test, this one included.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const createQuestion = vi.fn(async (_input: unknown) => ({ id: "new-q" }));
const updateQuestion = vi.fn(async (_id: string, _input: unknown) => {});
const setQuestionActive = vi.fn(async (_id: string, _active: boolean) => {});

vi.mock("@/app/(app)/school/question-actions", () => ({
  createQuestion: (input: unknown) => createQuestion(input),
  updateQuestion: (id: string, input: unknown) => updateQuestion(id, input),
  setQuestionActive: (id: string, active: boolean) => setQuestionActive(id, active),
}));

// P3-08: QuestionBankPanel now mounts ClassShareSection, which fetches its
// own share status on mount -- mocked here so these pre-existing tests
// (none of which are about sharing) never make a real, unmocked
// requireUser()/createClient() call. See class-share-section.test.tsx for
// the Share section's own behavior.
vi.mock("@/app/(app)/school/class-share-actions", () => ({
  createClassShare: vi.fn(async () => ({ rawToken: "unused-in-these-tests" })),
  revokeClassShare: vi.fn(async () => {}),
  getClassShareStatus: vi.fn(async () => ({ active: false, createdAt: null })),
  getSharePreview: vi.fn(async () => ({ className: "unused", questions: [] })),
}));

type DraftOutcome =
  | { status: "drafted"; drafts: { prompt: string; answer: string; topic: string | null; sourceSnippet: string | null }[]; truncated: boolean }
  | { status: "no_key" }
  | { status: "unavailable" }
  | { status: "parse_failed" };
const draftQuestionsFromNotes = vi.fn(async (_notes: string): Promise<DraftOutcome> => ({ status: "drafted", drafts: [], truncated: false }));

type TranscriptDraftOutcome =
  | { status: "drafted"; drafts: { prompt: string; answer: string; topic: string | null; sourceSnippet: string | null }[]; partial: boolean }
  | { status: "no_key" }
  | { status: "unavailable" }
  | { status: "parse_failed" }
  | { status: "not_ready" };
const draftQuestionsFromTranscript = vi.fn(
  async (_recordingId: string): Promise<TranscriptDraftOutcome> => ({ status: "drafted", drafts: [], partial: false }),
);

vi.mock("@/app/(app)/school/question-draft-actions", () => ({
  draftQuestionsFromNotes: (notes: string) => draftQuestionsFromNotes(notes),
  draftQuestionsFromTranscript: (recordingId: string) => draftQuestionsFromTranscript(recordingId),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function question(overrides: Partial<QuestionBankQuestion> = {}): QuestionBankQuestion {
  return {
    id: "q1",
    prompt: "What is the capital of Texas?",
    answer: "Austin",
    topic: "Geography",
    sourceAnchor: "Ch. 3, p.42",
    sourceSkipped: false,
    origin: "self",
    active: true,
    ...overrides,
  };
}

function lecture(overrides: Partial<QuestionBankLecture> = {}): QuestionBankLecture {
  return { id: "l1", originalFilename: "lecture1.mp3", transcriptStatus: "completed", ...overrides };
}

beforeEach(() => {
  createQuestion.mockClear();
  updateQuestion.mockClear();
  setQuestionActive.mockClear();
  draftQuestionsFromNotes.mockClear();
  draftQuestionsFromTranscript.mockClear();
  refresh.mockClear();
});

describe("QuestionBankPanel", () => {
  it("shows a real empty state with an Add action when there are no questions", () => {
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    expect(screen.getByText(/No questions yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
  });

  // Regression guard: the header's own Add button and the EmptyState's
  // action button both fire openAdd() and both were rendering at once when
  // the list was empty -- two identically-labeled controls on screen,
  // ambiguous to a screen reader and to this suite's own queries.
  it("shows exactly one Add question control when the list is empty, not two", () => {
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    expect(screen.getAllByRole("button", { name: "Add question" })).toHaveLength(1);
  });

  it("lists active questions with their prompt, topic, and origin badge", () => {
    render(
      <QuestionBankPanel
        classId="c1"
        questions={[question({ id: "q1", prompt: "Prompt A", topic: "Topic A", origin: "ai" })]}
      />
    );
    expect(screen.getByText("Prompt A")).toBeInTheDocument();
    expect(screen.getByText("Topic A")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("hides retired questions by default, behind a Show retired toggle", async () => {
    render(
      <QuestionBankPanel
        classId="c1"
        questions={[
          question({ id: "q1", prompt: "Active prompt", active: true }),
          question({ id: "q2", prompt: "Retired prompt", active: false }),
        ]}
      />
    );
    expect(screen.getByText("Active prompt")).toBeInTheDocument();
    expect(screen.queryByText("Retired prompt")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show retired (1)" }));
    expect(screen.getByText("Retired prompt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide retired" }));
    expect(screen.queryByText("Retired prompt")).not.toBeInTheDocument();
  });

  it("submits a new question through createQuestion with the class id and clears the form", async () => {
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText("Prompt"), "New prompt");
    await user.type(screen.getByPlaceholderText("Answer"), "New answer");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(1));
    expect(createQuestion).toHaveBeenCalledWith({
      classId: "c1",
      prompt: "New prompt",
      answer: "New answer",
      topic: null,
      sourceAnchor: null,
      sourceSkipped: false,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Form closes on success.
    expect(screen.queryByPlaceholderText("Prompt")).not.toBeInTheDocument();
  });

  it("keeps the form open with the typed draft intact when createQuestion rejects", async () => {
    createQuestion.mockRejectedValueOnce(new Error("Prompt is required"));
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText("Prompt"), "Kept prompt");
    await user.type(screen.getByPlaceholderText("Answer"), "Kept answer");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Prompt is required")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Prompt")).toHaveValue("Kept prompt");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edits an existing question through updateQuestion, pre-filling the draft", async () => {
    render(
      <QuestionBankPanel
        classId="c1"
        questions={[question({ id: "q1", prompt: "Old prompt", answer: "Old answer", topic: "Old topic" })]}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Old prompt" }));
    expect(screen.getByPlaceholderText("Prompt")).toHaveValue("Old prompt");

    await user.clear(screen.getByPlaceholderText("Prompt"));
    await user.type(screen.getByPlaceholderText("Prompt"), "Updated prompt");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));
    expect(updateQuestion).toHaveBeenCalledWith("q1", {
      prompt: "Updated prompt",
      answer: "Old answer",
      topic: "Old topic",
      sourceAnchor: "Ch. 3, p.42",
      sourceSkipped: false,
    });
  });

  it("retires an active question via setQuestionActive(id, false), never a delete call", async () => {
    render(<QuestionBankPanel classId="c1" questions={[question({ id: "q1", prompt: "To retire" })]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retire To retire" }));
    await waitFor(() => expect(setQuestionActive).toHaveBeenCalledWith("q1", false));
  });

  it("reactivates a retired question via setQuestionActive(id, true)", async () => {
    render(
      <QuestionBankPanel classId="c1" questions={[question({ id: "q1", prompt: "To reactivate", active: false })]} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show retired (1)" }));
    await user.click(screen.getByRole("button", { name: "Reactivate To reactivate" }));
    await waitFor(() => expect(setQuestionActive).toHaveBeenCalledWith("q1", true));
  });

  it("shows no Edit control on a retired question — only reactivate", async () => {
    render(
      <QuestionBankPanel classId="c1" questions={[question({ id: "q1", prompt: "Retired one", active: false })]} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show retired (1)" }));
    expect(screen.queryByRole("button", { name: "Edit Retired one" })).not.toBeInTheDocument();
  });

  it("clears the source anchor when 'No specific source' is toggled on", async () => {
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText("Source (e.g. Ch. 3, p.42)"), "p. 12");
    await user.click(screen.getByText("No specific source for this one"));
    expect(screen.getByPlaceholderText("Source (e.g. Ch. 3, p.42)")).toHaveValue("");
    expect(screen.getByPlaceholderText("Source (e.g. Ch. 3, p.42)")).toBeDisabled();
  });

  it("cancels the add form without calling createQuestion", async () => {
    render(<QuestionBankPanel classId="c1" questions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByPlaceholderText("Prompt"), "Abandoned");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Prompt")).not.toBeInTheDocument();
    expect(createQuestion).not.toHaveBeenCalled();
  });

  // Phase 1 #23: AI-drafted questions from pasted notes.
  describe("AI drafting from pasted notes", () => {
    it("shows the paste form when 'Draft with AI' is clicked even on an empty bank -- drafting has no empty-state equivalent", async () => {
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      expect(screen.getByPlaceholderText(/Paste lecture notes/)).toBeInTheDocument();
    });

    it("submits pasted notes and shows an editable review row per draft", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({
        status: "drafted",
        drafts: [{ prompt: "What is FSRS?", answer: "A spaced-repetition scheduler", topic: "Study techniques", sourceSnippet: "FSRS is a scheduler" }],
        truncated: false,
      });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "Some notes about FSRS");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));

      expect(draftQuestionsFromNotes).toHaveBeenCalledWith("Some notes about FSRS");
      await waitFor(() => expect(screen.getByDisplayValue("What is FSRS?")).toBeInTheDocument());
      expect(screen.getByDisplayValue("A spaced-repetition scheduler")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Study techniques")).toBeInTheDocument();
      // The model's own quoted snippet pre-fills the source anchor.
      expect(screen.getByDisplayValue("FSRS is a scheduler")).toBeInTheDocument();
    });

    it("adding one draft calls createQuestion with origin 'ai' and removes only that row", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({
        status: "drafted",
        drafts: [
          { prompt: "Q1", answer: "A1", topic: null, sourceSnippet: null },
          { prompt: "Q2", answer: "A2", topic: null, sourceSnippet: null },
        ],
        truncated: false,
      });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));
      await waitFor(() => expect(screen.getByDisplayValue("Q1")).toBeInTheDocument());

      const addButtons = screen.getAllByRole("button", { name: "Add" });
      await user.click(addButtons[0]!);

      await waitFor(() =>
        expect(createQuestion).toHaveBeenCalledWith(
          expect.objectContaining({ classId: "c1", prompt: "Q1", answer: "A1", origin: "ai", sourceSkipped: true })
        )
      );
      await waitFor(() => expect(screen.queryByDisplayValue("Q1")).not.toBeInTheDocument());
      expect(screen.getByDisplayValue("Q2")).toBeInTheDocument(); // the sibling row survives
    });

    it("a failed add keeps that row's edits and error visible without dropping the other rows", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({
        status: "drafted",
        drafts: [
          { prompt: "Bad row", answer: "A1", topic: null, sourceSnippet: null },
          { prompt: "Good row", answer: "A2", topic: null, sourceSnippet: null },
        ],
        truncated: false,
      });
      createQuestion.mockRejectedValueOnce(new Error("Provide a source anchor, or mark it skipped"));
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));
      await waitFor(() => expect(screen.getByDisplayValue("Bad row")).toBeInTheDocument());

      await user.click(screen.getAllByRole("button", { name: "Add" })[0]!);

      expect(await screen.findByText("Provide a source anchor, or mark it skipped")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Bad row")).toBeInTheDocument(); // not dropped
      expect(screen.getByDisplayValue("Good row")).toBeInTheDocument(); // sibling untouched
    });

    it("Add all adds every remaining draft", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({
        status: "drafted",
        drafts: [
          { prompt: "Q1", answer: "A1", topic: null, sourceSnippet: null },
          { prompt: "Q2", answer: "A2", topic: null, sourceSnippet: null },
        ],
        truncated: false,
      });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));
      await waitFor(() => expect(screen.getByDisplayValue("Q1")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Add all 2" }));

      await waitFor(() => expect(createQuestion).toHaveBeenCalledTimes(2));
      expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Q1", origin: "ai" }));
      expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Q2", origin: "ai" }));
      await waitFor(() => expect(screen.queryByDisplayValue("Q1")).not.toBeInTheDocument());
    });

    it("discarding a draft removes only that row, without calling createQuestion", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({
        status: "drafted",
        drafts: [{ prompt: "Discard me", answer: "A1", topic: null, sourceSnippet: null }],
        truncated: false,
      });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));
      await waitFor(() => expect(screen.getByDisplayValue("Discard me")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Discard this draft" }));

      expect(screen.queryByDisplayValue("Discard me")).not.toBeInTheDocument();
      expect(createQuestion).not.toHaveBeenCalled();
    });

    it("a no_key outcome shows the actionable message and keeps the pasted notes for retry", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({ status: "no_key" });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "Some notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));

      expect(await screen.findByText(/Add an API key in Settings to draft questions automatically/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Paste lecture notes/)).toHaveValue("Some notes");
    });

    it("manual entry still works after a no_key outcome -- cancelling the AI flow reaches the ordinary Add form", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({ status: "no_key" });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "Some notes");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));
      await screen.findByText(/Add an API key/);

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Add question" }));
      expect(screen.getByPlaceholderText("Prompt")).toBeInTheDocument();
    });

    it("an empty draft result shows a friendly, non-error message", async () => {
      draftQuestionsFromNotes.mockResolvedValueOnce({ status: "drafted", drafts: [], truncated: false });
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
      await user.type(screen.getByPlaceholderText(/Paste lecture notes/), "Just logistics, nothing to quiz");
      await user.click(screen.getByRole("button", { name: "Draft questions" }));

      expect(await screen.findByText(/No questions could be drafted/)).toBeInTheDocument();
    });
  });

  describe("Draft from transcript (P3-16)", () => {
    it("hides the 'Draft from transcript' trigger when no lecture has a completed transcript", () => {
      render(<QuestionBankPanel classId="c1" questions={[]} lectures={[lecture({ transcriptStatus: "processing" })]} />);
      expect(screen.queryByRole("button", { name: /Draft from transcript/ })).not.toBeInTheDocument();
    });

    it("hides the trigger entirely when no lectures prop is passed at all", () => {
      render(<QuestionBankPanel classId="c1" questions={[]} />);
      expect(screen.queryByRole("button", { name: /Draft from transcript/ })).not.toBeInTheDocument();
    });

    it("lists only completed transcripts in the picker, by filename", async () => {
      const user = userEvent.setup();
      render(
        <QuestionBankPanel
          classId="c1"
          questions={[]}
          lectures={[
            lecture({ id: "l1", originalFilename: "week1.mp3", transcriptStatus: "completed" }),
            lecture({ id: "l2", originalFilename: "week2.mp3", transcriptStatus: "processing" }),
          ]}
        />
      );

      await user.click(screen.getByRole("button", { name: /Draft from transcript/ }));

      expect(screen.getByText("week1.mp3")).toBeInTheDocument();
      expect(screen.queryByText("week2.mp3")).not.toBeInTheDocument();
    });

    it("picking a recording drafts from it and opens the SAME review flow notes-based drafting uses", async () => {
      draftQuestionsFromTranscript.mockResolvedValueOnce({
        status: "drafted",
        drafts: [{ prompt: "What is X?", answer: "Y", topic: null, sourceSnippet: "as mentioned in the recording" }],
        partial: false,
      });
      const user = userEvent.setup();
      render(<QuestionBankPanel classId="c1" questions={[]} lectures={[lecture({ id: "rec-1", originalFilename: "week1.mp3" })]} />);

      await user.click(screen.getByRole("button", { name: /Draft from transcript/ }));
      await user.click(screen.getByRole("button", { name: "Draft" }));

      expect(draftQuestionsFromTranscript).toHaveBeenCalledWith("rec-1");
      // Drafts render as editable inputs (review-before-add), not static text.
      expect(await screen.findByDisplayValue("What is X?")).toBeInTheDocument();
      // Same review UI as notes-based drafting -- an Add button per row.
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("shows the partial-transcript notice distinct from the notes-truncation one", async () => {
      draftQuestionsFromTranscript.mockResolvedValueOnce({
        status: "drafted",
        drafts: [{ prompt: "Q", answer: "A", topic: null, sourceSnippet: null }],
        partial: true,
      });
      const user = userEvent.setup();
      render(<QuestionBankPanel classId="c1" questions={[]} lectures={[lecture({ id: "rec-1" })]} />);

      await user.click(screen.getByRole("button", { name: /Draft from transcript/ }));
      await user.click(screen.getByRole("button", { name: "Draft" }));

      expect(await screen.findByText(/only part of it was read/)).toBeInTheDocument();
    });

    it("a no_key outcome shows the same actionable message as the notes-based flow", async () => {
      draftQuestionsFromTranscript.mockResolvedValueOnce({ status: "no_key" });
      const user = userEvent.setup();
      render(<QuestionBankPanel classId="c1" questions={[]} lectures={[lecture({ id: "rec-1" })]} />);

      await user.click(screen.getByRole("button", { name: /Draft from transcript/ }));
      await user.click(screen.getByRole("button", { name: "Draft" }));

      expect(await screen.findByText(/Add an API key in Settings to draft questions automatically/)).toBeInTheDocument();
    });

    it("Cancel from the picker returns to the closed state without calling the drafter", async () => {
      const user = userEvent.setup();
      render(<QuestionBankPanel classId="c1" questions={[]} lectures={[lecture({ id: "rec-1" })]} />);

      await user.click(screen.getByRole("button", { name: /Draft from transcript/ }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(draftQuestionsFromTranscript).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /Draft from transcript/ })).toBeInTheDocument();
    });
  });
});
