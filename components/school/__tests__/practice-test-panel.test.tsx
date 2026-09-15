import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PracticeTestPanel } from "../practice-test-panel";
import type { PracticeTestListItem, PracticeTestQuestion } from "@/app/(app)/school/practice-test-actions";

const getMyPracticeTestsMock = vi.fn(async (..._args: unknown[]): Promise<PracticeTestListItem[]> => []);
const getPracticeTestQuestionsMock = vi.fn(async (..._args: unknown[]): Promise<PracticeTestQuestion[]> => []);
const submitPracticeTestAnswerMock = vi.fn(async (..._args: unknown[]) => {});
const completePracticeTestMock = vi.fn(async (..._args: unknown[]) => ({ scorePct: 100, answeredCount: 1, questionCount: 1 }));
vi.mock("@/app/(app)/school/practice-test-actions", () => ({
  getMyPracticeTests: (...args: unknown[]) => getMyPracticeTestsMock(...args),
  getPracticeTestQuestions: (...args: unknown[]) => getPracticeTestQuestionsMock(...args),
  submitPracticeTestAnswer: (...args: unknown[]) => submitPracticeTestAnswerMock(...args),
  completePracticeTest: (...args: unknown[]) => completePracticeTestMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PracticeTestPanel (P2-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyPracticeTestsMock.mockResolvedValue([]);
    getPracticeTestQuestionsMock.mockResolvedValue([]);
    completePracticeTestMock.mockResolvedValue({ scorePct: 100, answeredCount: 1, questionCount: 1 });
  });

  it("shows a clean empty state when there are no practice tests yet", async () => {
    render(<PracticeTestPanel classId="c1" />);
    expect(await screen.findByText(/no practice tests yet/i)).toBeInTheDocument();
  });

  it("lists a pending test with a Start button, and a completed test with its score, not a Start button", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-14", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
      { id: "pt2", assessmentId: "a1", intervalLabel: "T-7", questionIds: ["q1"], status: "completed", scorePct: 90, createdAt: "2026-09-08T00:00:00Z", completedAt: "2026-09-08T01:00:00Z" },
    ]);
    render(<PracticeTestPanel classId="c1" />);

    const pendingRow = await screen.findByTestId("practice-test-pt1");
    expect(pendingRow).toHaveTextContent(/T-14/);
    expect(pendingRow.querySelector("button")).toHaveTextContent("Start");

    const completedRow = await screen.findByTestId("practice-test-pt2");
    expect(completedRow).toHaveTextContent(/90% correct/);
    expect(completedRow.querySelector("button")).toBeNull();
  });

  it("starting a test fetches its questions and enters the take-flow", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-14", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
    ]);
    getPracticeTestQuestionsMock.mockResolvedValue([{ id: "q1", prompt: "What is Big-O of binary search?", answer: "O(log n)" }]);
    const user = userEvent.setup();
    render(<PracticeTestPanel classId="c1" />);

    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(getPracticeTestQuestionsMock).toHaveBeenCalledWith("pt1");
    expect(await screen.findByText(/what is big-o of binary search/i)).toBeInTheDocument();
  });

  it("THE REGRESSION GUARD: the answer is not shown until Reveal is tapped", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-14", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
    ]);
    getPracticeTestQuestionsMock.mockResolvedValue([{ id: "q1", prompt: "What is Big-O of binary search?", answer: "O(log n)" }]);
    const user = userEvent.setup();
    render(<PracticeTestPanel classId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Start" }));

    await screen.findByText(/what is big-o of binary search/i);
    expect(screen.queryByText("O(log n)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("O(log n)")).toBeInTheDocument();
  });

  it("self-reporting on the LAST question submits the answer, completes the test, and returns to the list", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-1", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
    ]);
    getPracticeTestQuestionsMock.mockResolvedValue([{ id: "q1", prompt: "Only question", answer: "The answer" }]);
    const user = userEvent.setup();
    render(<PracticeTestPanel classId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("Only question");
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Got it right" }));

    await waitFor(() => expect(submitPracticeTestAnswerMock).toHaveBeenCalledWith("pt1", "q1", true));
    await waitFor(() => expect(completePracticeTestMock).toHaveBeenCalledWith("pt1"));
    // Back to the list view -- the "Loading…" or list text, not the taker's question text.
    await waitFor(() => expect(screen.queryByText("Only question")).not.toBeInTheDocument());
  });

  it("self-reporting on a NON-last question advances without completing the test", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-3", questionIds: ["q1", "q2"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
    ]);
    getPracticeTestQuestionsMock.mockResolvedValue([
      { id: "q1", prompt: "First question", answer: "A1" },
      { id: "q2", prompt: "Second question", answer: "A2" },
    ]);
    const user = userEvent.setup();
    render(<PracticeTestPanel classId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("First question");
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(screen.getByRole("button", { name: "Got it wrong" }));

    expect(await screen.findByText("Second question")).toBeInTheDocument();
    expect(completePracticeTestMock).not.toHaveBeenCalled();
    // The next question's own answer must not already be revealed.
    expect(screen.queryByText("A2")).not.toBeInTheDocument();
  });

  it("Exit returns to the list without submitting anything", async () => {
    getMyPracticeTestsMock.mockResolvedValue([
      { id: "pt1", assessmentId: "a1", intervalLabel: "T-14", questionIds: ["q1"], status: "pending", scorePct: null, createdAt: "2026-09-01T00:00:00Z", completedAt: null },
    ]);
    getPracticeTestQuestionsMock.mockResolvedValue([{ id: "q1", prompt: "A question", answer: "An answer" }]);
    const user = userEvent.setup();
    render(<PracticeTestPanel classId="c1" />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("A question");
    await user.click(screen.getByRole("button", { name: "Exit" }));

    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(submitPracticeTestAnswerMock).not.toHaveBeenCalled();
  });
});
