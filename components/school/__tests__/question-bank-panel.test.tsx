import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuestionBankPanel, type QuestionBankQuestion } from "../question-bank-panel";

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

beforeEach(() => {
  createQuestion.mockClear();
  updateQuestion.mockClear();
  setQuestionActive.mockClear();
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
});
