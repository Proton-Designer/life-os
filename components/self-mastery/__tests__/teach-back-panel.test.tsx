import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TeachBackPanel } from "../teach-back-panel";
import type { TeachableLesson, SubmitTeachBackResult } from "@/app/(app)/personal/teach-back-actions";

const getTeachableLessonsMock = vi.fn(async (..._args: unknown[]): Promise<TeachableLesson[]> => []);
const submitTeachBackMock = vi.fn(async (..._args: unknown[]): Promise<SubmitTeachBackResult> => ({ outcome: "evaluated", followUpQuestions: [], gapFeedback: "" }));
vi.mock("@/app/(app)/personal/teach-back-actions", () => ({
  getTeachableLessons: (...args: unknown[]) => getTeachableLessonsMock(...args),
  submitTeachBack: (...args: unknown[]) => submitTeachBackMock(...args),
}));

describe("TeachBackPanel (P2-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTeachableLessonsMock.mockResolvedValue([]);
  });

  it("renders nothing when there are no ready books", () => {
    const { container } = render(<TeachBackPanel books={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("picking a book fetches its lessons", async () => {
    getTeachableLessonsMock.mockResolvedValue([{ id: "l1", title: "Spaced repetition", coreClaim: null }]);
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));

    await waitFor(() => expect(getTeachableLessonsMock).toHaveBeenCalledWith("b1"));
    expect(await screen.findByRole("button", { name: "Spaced repetition" })).toBeInTheDocument();
  });

  it("shows a clean empty state for a book with no teachable lessons", async () => {
    getTeachableLessonsMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));

    expect(await screen.findByText(/no lessons ready to teach back on yet/i)).toBeInTheDocument();
  });

  it("the explanation textarea only appears after picking a lesson", async () => {
    getTeachableLessonsMock.mockResolvedValue([{ id: "l1", title: "Spaced repetition", coreClaim: null }]);
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));
    await screen.findByRole("button", { name: "Spaced repetition" });
    expect(screen.queryByPlaceholderText(/explain this lesson/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Spaced repetition" }));
    expect(screen.getByPlaceholderText(/explain this lesson/i)).toBeInTheDocument();
  });

  it("submitting calls submitTeachBack with the lesson id and typed explanation, then shows the result", async () => {
    getTeachableLessonsMock.mockResolvedValue([{ id: "l1", title: "Spaced repetition", coreClaim: null }]);
    submitTeachBackMock.mockResolvedValue({
      outcome: "evaluated",
      followUpQuestions: ["What if you review too early?"],
      gapFeedback: "You missed the retrieval-effort mechanism.",
    });
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));
    await user.click(await screen.findByRole("button", { name: "Spaced repetition" }));
    await user.type(screen.getByPlaceholderText(/explain this lesson/i), "My own explanation.");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(submitTeachBackMock).toHaveBeenCalledWith("l1", "My own explanation."));
    expect(await screen.findByText("You missed the retrieval-effort mechanism.")).toBeInTheDocument();
    expect(screen.getByText("What if you review too early?")).toBeInTheDocument();
  });

  it("a non-evaluated outcome (e.g. no_key) shows its own message, not the results block", async () => {
    getTeachableLessonsMock.mockResolvedValue([{ id: "l1", title: "Spaced repetition", coreClaim: null }]);
    submitTeachBackMock.mockResolvedValue({ outcome: "no_key" });
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));
    await user.click(await screen.findByRole("button", { name: "Spaced repetition" }));
    await user.type(screen.getByPlaceholderText(/explain this lesson/i), "My own explanation.");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/add an api key/i)).toBeInTheDocument();
    expect(screen.queryByText("Gap feedback")).not.toBeInTheDocument();
  });

  it("Submit stays disabled until there's real text", async () => {
    getTeachableLessonsMock.mockResolvedValue([{ id: "l1", title: "Spaced repetition", coreClaim: null }]);
    const user = userEvent.setup();
    render(<TeachBackPanel books={[{ id: "b1", title: "Atomic Habits" }]} />);
    await user.click(screen.getByRole("button", { name: "Atomic Habits" }));
    await user.click(await screen.findByRole("button", { name: "Spaced repetition" }));
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});
